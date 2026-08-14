import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedChat } from '../../shared/types.js';
import { promptPreamble, renderTranscript } from '../../shared/transcript.js';

export { renderTranscript };
import { parseChatWithDiagnostics } from './index.js';

const PERSONA_PATH = fileURLToPath(new URL('../../shared/persona.md', import.meta.url));

export async function renderPrompt(chat: ParsedChat): Promise<string> {
  const persona = await readFile(PERSONA_PATH, 'utf8');
  return `${promptPreamble(chat, persona)}
---

# Your task

Read \`work/${chat.slug}/transcript.md\` in full, then write \`work/${chat.slug}/report.json\`
following the \`Report\` type in \`shared/types.ts\`.

- \`chatSlug\` must be \`"${chat.slug}"\`.
- Generate a UUID v4 for \`id\`.
- \`reportType\` is \`"classic"\`; \`groupName\` is \`"${chat.groupName}"\`.
- \`persona\` is \`{ "name": "Otis", "tagline": "An AI with no filter, too many opinions and nowhere else to be." }\`.
- Quote only by \`msgIndexes\` - the \`[i]\` numbers in transcript.md. Never invent or retype
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
