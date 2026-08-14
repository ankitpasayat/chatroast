/**
 * Getting the transcript out of a WhatsApp export, in the browser.
 * fflate's filter runs before inflation, so the media in a 150 MB export is
 * never decompressed and never leaves the machine.
 */
import { unzipSync } from 'fflate';

const TXT = /\.txt$/i;
const CHAT_HINT = /WhatsApp Chat|_chat/i;

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function decode(bytes: Uint8Array): string {
  const s = new TextDecoder('utf-8').decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** null when the archive holds no identifiable chat transcript. */
export function extractChatText(
  bytes: Uint8Array,
  filename: string,
): { name: string; text: string } | null {
  if (TXT.test(filename)) return { name: basename(filename), text: decode(bytes) };

  const entries = unzipSync(bytes, {
    filter: (f) =>
      TXT.test(f.name) && !f.name.startsWith('__MACOSX/') && !basename(f.name).startsWith('.'),
  });

  const names = Object.keys(entries);
  if (names.length === 0) return null;

  const pick =
    names.find((n) => basename(n).toLowerCase() === '_chat.txt') ??
    names.find((n) => CHAT_HINT.test(basename(n))) ??
    (names.length === 1 ? names[0] : null);

  if (!pick) return null; // several .txt files and none of them is obviously the chat
  return { name: basename(pick), text: decode(entries[pick]!) };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function day(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? String(ts ?? '').slice(0, 10)
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRange(firstTs: string, lastTs: string): string {
  if (!firstTs && !lastTs) return 'unknown';
  return `${day(firstTs)} to ${day(lastTs)}`;
}
