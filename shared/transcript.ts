/**
 * Pure transcript + prompt-preamble rendering - no I/O, safe in Node and the
 * browser. The file-mode CLI (src/parser/ingest.ts) and the static BYOK app
 * (web/) both build on these so a chat reads identically everywhere.
 */
import type { ChatMessage, ParsedChat } from './types.js';

export function dateOf(ts: string): string {
  return ts.slice(0, 10);
}

function sendersSummary(chat: ParsedChat): string {
  return chat.senders.map((s) => `${s.name} (${s.count})`).join(', ');
}

/**
 * Text that carries no information beyond the media marker itself: WhatsApp's
 * generated attachment filenames and the "media not included" placeholders.
 * Real document/contact filenames are kept - they say something.
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
  out.push(`# ${chat.groupName} - transcript`);
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

/**
 * Everything a report-authoring prompt needs before the task section:
 * the persona spec plus this chat's stats. Callers append their own
 * "# Your task" section (file-mode and BYOK word it differently).
 */
export function promptPreamble(chat: ParsedChat, personaText: string): string {
  const senderTable = [
    '| Sender | Messages |',
    '| --- | --- |',
    ...chat.senders.map((s) => `| ${s.name} | ${s.count} |`),
  ].join('\n');

  return `${personaText.trimEnd()}

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
`;
}
