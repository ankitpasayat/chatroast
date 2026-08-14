import type { ChatMessage, ParsedChat, SenderStat } from '../../shared/types.js';

/**
 * WhatsApp chat export parser (iOS + Android text exports).
 *
 * Key insight from the real exports in fixtures/: iOS marks every
 * non-plain-text message body with a U+200E LEFT-TO-RIGHT MARK right after
 * "Sender: ". That single flag distinguishes system notices, attachments,
 * "video omitted" placeholders and deleted-message tombstones from ordinary
 * user text far more reliably than phrase matching ("I added the AI" is a real
 * user message in the fixtures, not a group-membership notice).
 */

/** Directional marks WhatsApp sprinkles around structural bits. */
const MARKS = /[‎‏]/g;

/** `[07/02/23, 19:55:05] rest` — also 4-digit years, dd.mm.yy, am/pm, no seconds. */
const IOS_LINE =
  /^[‎‏\s]*\[(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\.?)?\s*\]\s*([\s\S]*)$/i;

/** `07/02/23, 19:55 - rest` — also `7/2/23`, `7:55 pm`, `dd.mm.yy`. */
const ANDROID_LINE =
  /^[‎‏\s]*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\.?)?\s+-\s+([\s\S]*)$/i;

/** `Sender: body` — non-greedy so the first `: ` wins. */
const SENDER_SPLIT = /^(.{1,120}?):(?:[\u0020\u00a0\u202f]([\s\S]*))?$/;

/**
 * System notices. Only ever tested against a body flagged with a directional
 * mark, so ordinary text like "I added the AI" can never be mistaken for one.
 */
const SYSTEM_PHRASES = [
  /are end-to-end encrypted/i,
  /created (?:this group|group [“"])/i,
  / added /i,
  / removed /i,
  / left$/i,
  /changed the group name to /i,
  /changed (?:this group's icon|the subject|their phone number)/i,
  /joined using this group's invite link/i,
  /(?:is|are|You're) now an admin/i,
  /turned (?:on|off) disappearing messages/i,
  /security code changed/i,
];

const ATTACHED = /<attached:\s*([^>]*)>/;
const EDITED = /\s*<This message was edited>\s*$/;
const OMITTED = /^(image|photo|video|audio|sticker|gif|document|contact card)\s+omitted$/i;
const DELETED = /^(This message was deleted\.?|You deleted this message\.?)$/;
const RENAME = /changed the group name to [“"”](.+)[”"“]\s*$/;

type MediaType = NonNullable<ChatMessage['mediaType']>;

/** One physical export line that started a message, plus its continuations. */
interface Raw {
  ts: string;
  sender: string | null;
  /** True when the body was flagged with a directional mark (iOS structural marker). */
  flagged: boolean;
  lines: string[];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** dd, mm, yy|yyyy, hh, mm, ss?, am/pm? -> "YYYY-MM-DDTHH:mm:ss" (local, no zone). */
function toIso(
  d: string,
  mo: string,
  y: string,
  h: string,
  mi: string,
  s: string | undefined,
  ampm: string | undefined,
): string {
  let hour = Number(h);
  if (ampm) {
    const pm = ampm.toLowerCase() === 'p';
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  const year = y.length <= 2 ? 2000 + Number(y) : Number(y);
  return `${year}-${pad(Number(mo))}-${pad(Number(d))}T${pad(hour)}:${pad(Number(mi))}:${pad(Number(s ?? '0'))}`;
}

function mediaTypeFromFilename(name: string): MediaType {
  const marker = /(?:^|[-_ ])(GIF|PHOTO|VIDEO|STICKER|AUDIO|PTT)(?:[-_ ]|$)/i.exec(name);
  if (marker) {
    const m = marker[1]!.toUpperCase();
    if (m === 'PTT' || m === 'AUDIO') return 'audio';
    return m.toLowerCase() as MediaType;
  }
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  if (ext === 'vcf') return 'contact';
  if (['jpg', 'jpeg', 'png', 'heic', 'gif'].includes(ext)) return ext === 'gif' ? 'gif' : 'photo';
  if (['webp'].includes(ext)) return 'sticker';
  if (['mp4', 'mov', 'avi', 'mkv', '3gp'].includes(ext)) return 'video';
  if (['opus', 'm4a', 'mp3', 'ogg', 'wav', 'aac'].includes(ext)) return 'audio';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rtf'].includes(ext))
    return 'document';
  return 'unknown';
}

function mediaTypeFromWord(word: string): MediaType {
  const w = word.toLowerCase();
  if (w === 'image') return 'photo';
  if (w === 'contact card') return 'contact';
  return w as MediaType;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'chat';
}

/** "WhatsApp Chat - Chai Chat.txt" / "chai-chat.txt" -> "Chai Chat" / "chai-chat". */
function stemOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base
    .replace(/\.(txt|zip)$/i, '')
    .replace(/^WhatsApp Chat(?: -| with)? /i, '')
    .trim();
}

function splitSender(rest: string): { sender: string | null; body: string } {
  const m = SENDER_SPLIT.exec(rest);
  if (!m) return { sender: null, body: rest };
  return { sender: m[1]!.replace(MARKS, '').trim(), body: m[2] ?? '' };
}

/** Try to read a line as the start of a new message in the given format. */
function matchStart(line: string, format: 'ios' | 'android'): Raw | null {
  const m = (format === 'ios' ? IOS_LINE : ANDROID_LINE).exec(line);
  if (!m) return null;
  const ts = toIso(m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6], m[7]);
  const { sender, body } = splitSender(m[8]!);
  return { ts, sender, flagged: /^[‎‏]/.test(body), lines: [body] };
}

function detectFormat(lines: string[]): 'ios' | 'android' {
  let ios = 0;
  let android = 0;
  for (const line of lines) {
    if (IOS_LINE.test(line)) ios++;
    else if (ANDROID_LINE.test(line)) android++;
    if (ios + android >= 50) break;
  }
  return android > ios ? 'android' : 'ios';
}

function finalize(raw: Raw, index: number): ChatMessage {
  // Assemble continuations, then trim trailing blank lines (export files end
  // with a newline, which would otherwise glue onto the last message).
  let text = raw.lines.join('\n').replace(/\s+$/, '');
  let edited = false;
  if (EDITED.test(text.replace(MARKS, ''))) {
    edited = true;
    text = text.replace(MARKS, '').replace(EDITED, '');
  }

  const clean = text.replace(MARKS, '').trim();
  const first = raw.lines[0]!.replace(MARKS, '').trim();

  const base = { index, ts: raw.ts, sender: raw.sender, edited } as const;
  const msg = (over: Partial<ChatMessage>): ChatMessage => {
    const out: ChatMessage = { ...base, kind: 'text', text: clean, ...over };
    if (!out.edited) delete out.edited;
    return out;
  };

  // An <attached:> marker can sit on a continuation line after a long caption,
  // so look at the whole assembled message, not just the first line.
  const att = ATTACHED.exec(clean);
  if (att) {
    const file = att[1]!.trim();
    const caption = clean.replace(ATTACHED, '').trim();
    return msg({ kind: 'media', mediaType: mediaTypeFromFilename(file), text: caption || file });
  }
  if (/^<Media omitted>$/i.test(first)) {
    return msg({ kind: 'media', mediaType: 'unknown', text: '<Media omitted>' });
  }
  if (raw.flagged) {
    if (/^Location: https:\/\/maps\.google\.com/i.test(first)) {
      return msg({ kind: 'media', mediaType: 'location' });
    }
    const om = OMITTED.exec(first);
    if (om) return msg({ kind: 'media', mediaType: mediaTypeFromWord(om[1]!) });
    if (DELETED.test(first)) return msg({});
    if (SYSTEM_PHRASES.some((re) => re.test(first))) return msg({ kind: 'system', sender: null });
    // Anything else flagged (polls, call logs, future markers) stays an
    // authored message: better a plain text message than a lost sender.
    return msg({});
  }
  // Android system notices carry no "Sender: " prefix at all.
  if (raw.sender === null) return msg({ kind: 'system', sender: null });
  return msg({});
}

/**
 * groupName: the most recent explicit rename wins; otherwise the display name
 * that only ever authors system notices (WhatsApp stamps those with the group
 * name); otherwise the filename stem.
 */
function detectGroupName(
  messages: ChatMessage[],
  systemSenders: Map<string, number>,
  humanSenders: Set<string>,
  filename: string,
): string {
  let rename: string | null = null;
  for (const m of messages) {
    if (m.kind !== 'system') continue;
    const hit = RENAME.exec(m.text.replace(MARKS, '').trim());
    if (hit) rename = hit[1]!.trim();
  }
  if (rename) return rename;

  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of systemSenders) {
    if (humanSenders.has(name)) continue;
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best ?? (stemOf(filename) || 'Chat');
}

export function parseChatWithDiagnostics(
  filename: string,
  text: string,
): { chat: ParsedChat; anomalies: string[] } {
  const anomalies: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const format = detectFormat(lines);

  const raws: Raw[] = [];
  /** Sender name as written on lines that turn out to be system notices. */
  const systemSenderNames: string[] = [];
  let open: Raw | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const start = matchStart(line, format);
    if (start) {
      if (start.sender === null && format === 'ios') {
        anomalies.push(`line ${i + 1}: timestamped line without a sender: ${line.slice(0, 80)}`);
      }
      open = start;
      raws.push(start);
      systemSenderNames.push(start.sender ?? '');
      continue;
    }
    if (open) {
      open.lines.push(line);
      continue;
    }
    if (line.trim() !== '') {
      anomalies.push(`line ${i + 1}: text before the first message: ${line.slice(0, 80)}`);
    }
  }

  const messages = raws.map((raw, i) => finalize(raw, i));

  const systemSenders = new Map<string, number>();
  const humanSenders = new Set<string>();
  const counts = new Map<string, number>();
  messages.forEach((m, i) => {
    const written = systemSenderNames[i]!;
    if (m.kind === 'system') {
      if (written) systemSenders.set(written, (systemSenders.get(written) ?? 0) + 1);
      return;
    }
    if (m.sender) {
      humanSenders.add(m.sender);
      counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
    }
  });

  const groupName = detectGroupName(messages, systemSenders, humanSenders, filename);
  const senders: SenderStat[] = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const chat: ParsedChat = {
    slug: slugify(groupName),
    groupName,
    format,
    messages,
    senders,
    firstTs: messages[0]?.ts ?? '',
    lastTs: messages[messages.length - 1]?.ts ?? '',
    messageCount: messages.filter((m) => m.kind !== 'system').length,
  };
  return { chat, anomalies };
}

export function parseChat(filename: string, text: string): ParsedChat {
  return parseChatWithDiagnostics(filename, text).chat;
}
