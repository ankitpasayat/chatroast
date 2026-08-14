import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatMessage, ParsedChat } from '../../shared/types.js';
import { parseChatWithDiagnostics } from './index.js';

const PERSONA_PATH = fileURLToPath(new URL('../../shared/persona.md', import.meta.url));

function dateOf(ts: string): string {
  return ts.slice(0, 10);
}

function sendersSummary(chat: ParsedChat): string {
  return chat.senders.map((s) => `${s.name} (${s.count})`).join(', ');
}

/**
 * Text that carries no information beyond the media marker itself: WhatsApp's
 * generated attachment filenames and the "media not included" placeholders.
 * Real document/contact filenames are kept — they say something.
 */
const NOISE =
  /^(?:\d+-(?:PHOTO|VIDEO|GIF|STICKER|AUDIO|PTT)-[\d-]+\.\w+|<Media omitted>|(?:image|photo|video|audio|sticker|gif|document|contact card) omitted|Location: \S+)$/i;

/** `<photo>` / `<video>` / ... with the caption appended when there is one. */
function mediaLabel(m: ChatMessage): string {
  const marker = `<${m.mediaType ?? 'unknown'}>`;
  const caption = m.text.trim();
  return caption === '' || NOISE.test(caption) ? marker : `${marker} ${caption}`;
}

function transcriptBody(m: ChatMessage): string {
  if (m.kind === 'media') return mediaLabel(m);
  return m.text;
}

export function renderTranscript(chat: ParsedChat): string {
  const out: string[] = [];
  out.push(`# ${chat.groupName} — transcript`);
  out.push(
    `${chat.messageCount} messages | ${sendersSummary(chat)} | ${dateOf(chat.firstTs)} → ${dateOf(chat.lastTs)}`,
  );

  let day = '';
  for (const m of chat.messages) {
    const d = dateOf(m.ts);
    if (d !== day) {
      day = d;
      out.push('');
      out.push(`## ${d}`);
    }
    const head = m.kind === 'system' ? `[${m.index}] * ` : `[${m.index}] ${m.sender}: `;
    const [first = '', ...rest] = transcriptBody(m).split('\n');
    out.push(head + first);
    for (const line of rest) out.push(`  ${line}`);
  }
  out.push('');
  return out.join('\n');
}

export async function renderPrompt(chat: ParsedChat): Promise<string> {
  const persona = await readFile(PERSONA_PATH, 'utf8');
  const senderTable = [
    '| Sender | Messages |',
    '| --- | --- |',
    ...chat.senders.map((s) => `| ${s.name} | ${s.count} |`),
  ].join('\n');

  return `${persona.trimEnd()}

---

# This chat

- **Group name:** ${chat.groupName}
- **Slug:** ${chat.slug}
- **Export format:** ${chat.format}
- **Messages (excluding system notices):** ${chat.messageCount}
- **Total lines in transcript (including system notices):** ${chat.messages.length}
- **Date range:** ${dateOf(chat.firstTs)} → ${dateOf(chat.lastTs)}
- **Participants:** ${chat.senders.length}

${senderTable}

---

# Your task

Read \`work/${chat.slug}/transcript.md\` in full, then write \`work/${chat.slug}/report.json\`
following the \`Report\` type in \`shared/types.ts\`.

- \`chatSlug\` must be \`"${chat.slug}"\`.
- Generate a UUID v4 for \`id\`.
- \`reportType\` is \`"classic"\`; \`groupName\` is \`"${chat.groupName}"\`.
- \`persona\` is \`{ "name": "Otis", "tagline": "An AI with no filter, too many opinions and nowhere else to be." }\`.
- Quote only by \`msgIndexes\` — the \`[i]\` numbers in transcript.md. Never invent or retype
  quote text; the renderer prints the real message. Valid indexes are 0..${Math.max(chat.messages.length - 1, 0)}.
- Inline markup allowed in any text: \`**bold**\`, \`*italic*\` and backtick-wrapped \`code\`. Nothing else.
- Follow the persona and section order above exactly.
`;
}

/**
 * Parse a raw WhatsApp export and write work/<slug>/{chat.json,transcript.md,PROMPT.md}.
 * Shared by the CLI and the server's POST /api/chats.
 */
export async function ingestChat(
  filename: string,
  text: string,
  workDir: string,
): Promise<ParsedChat> {
  const { chat } = parseChatWithDiagnostics(filename, text);
  const dir = path.join(workDir, chat.slug);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dir, 'chat.json'), `${JSON.stringify(chat, null, 2)}\n`, 'utf8'),
    writeFile(path.join(dir, 'transcript.md'), renderTranscript(chat), 'utf8'),
    renderPrompt(chat).then((p) => writeFile(path.join(dir, 'PROMPT.md'), p, 'utf8')),
  ]);
  return chat;
}
