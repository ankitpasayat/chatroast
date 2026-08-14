import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parseChatWithDiagnostics } from '../parser/index.js';
import { ingestChat } from '../parser/ingest.js';

const WORK_DIR = path.resolve('work');

/** A line that starts like either export format — used to spot the chat .txt in a zip. */
const LOOKS_LIKE_CHAT =
  /^[‎‏\s]*(?:\[\d{1,2}[./-]\d{1,2}[./-]\d{2,4},|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}, ?\d{1,2}:\d{2})/;

function looksLikeChat(text: string): boolean {
  return text
    .split(/\r\n|\n|\r/, 20)
    .some((line) => LOOKS_LIKE_CHAT.test(line));
}

/** Pull the chat transcript out of a WhatsApp export zip. Media entries are never inflated. */
function readZip(file: string): { name: string; text: string } {
  // filter runs before decompression, so the ~100MB of media in a real export is skipped.
  const entries = unzipSync(readFileSync(file), {
    filter: (f) => /\.txt$/i.test(f.name) && f.originalSize < 64 * 1024 * 1024,
  });
  const decode = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);
  const names = Object.keys(entries);

  const chatTxt = names.find((n) => path.basename(n).toLowerCase() === '_chat.txt');
  if (chatTxt) {
    // `_chat.txt` is a useless name; fall back to the zip's own name for the stem.
    return { name: path.basename(file), text: decode(entries[chatTxt]!) };
  }
  for (const n of names) {
    const text = decode(entries[n]!);
    if (looksLikeChat(text)) return { name: path.basename(n), text };
  }
  throw new Error(`no WhatsApp chat .txt found inside ${file} (entries: ${names.join(', ') || 'none'})`);
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(14)}  ${value}`;
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    console.error('usage: npm run ingest -- <chat.txt | WhatsApp Chat - Foo.zip>');
    process.exitCode = 1;
    return;
  }

  const file = path.resolve(input);
  const { name, text } = /\.zip$/i.test(file)
    ? readZip(file)
    : { name: path.basename(file), text: readFileSync(file, 'utf8') };

  const { anomalies } = parseChatWithDiagnostics(name, text);
  const chat = await ingestChat(name, text, WORK_DIR);
  const outDir = path.join(WORK_DIR, chat.slug);

  console.log('');
  console.log(row('group name', chat.groupName));
  console.log(row('slug', chat.slug));
  console.log(row('format', chat.format));
  console.log(row('messages', `${chat.messageCount} (+${chat.messages.length - chat.messageCount} system)`));
  console.log(row('date range', `${chat.firstTs.slice(0, 10)} → ${chat.lastTs.slice(0, 10)}`));
  console.log(row('anomalies', String(anomalies.length)));
  console.log(row('written to', outDir));
  console.log('');
  console.log('  top senders');
  const width = Math.max(...chat.senders.slice(0, 10).map((s) => s.name.length), 4);
  for (const s of chat.senders.slice(0, 10)) {
    console.log(`    ${s.name.padEnd(width)}  ${String(s.count).padStart(5)}`);
  }
  if (chat.senders.length > 10) console.log(`    ... and ${chat.senders.length - 10} more`);
  console.log('');
  for (const a of anomalies.slice(0, 10)) console.log(`  ! ${a}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
