/**
 * Pure Report validation - no I/O, safe in Node and the browser.
 * Used by the local server (src/server/storage.ts) and the static BYOK app (web/).
 */
import type { Block, ParsedChat, Report } from './types.js';

export class ValidationError extends Error {}

function fail(where: string, why: string): never {
  throw new ValidationError(`${where}: ${why}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(where: string, obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    fail(where, `"${key}" must be a non-empty string (got ${JSON.stringify(v)})`);
  }
  return v;
}

function validateBlock(where: string, raw: unknown, i: number, chat: ParsedChat): Block {
  const at = `${where}: blocks[${i}]`;
  if (!isRecord(raw)) fail(at, 'must be an object');
  const type = raw['type'];
  switch (type) {
    case 'paragraph':
      return { type, text: str(at, raw, 'text') };
    case 'heading':
      return { type, emoji: str(at, raw, 'emoji'), title: str(at, raw, 'title') };
    case 'entry':
      return { type, label: str(at, raw, 'label'), text: str(at, raw, 'text') };
    case 'quote': {
      const idx = raw['msgIndexes'];
      if (!Array.isArray(idx) || idx.length === 0) {
        fail(at, '"msgIndexes" must be a non-empty array');
      }
      const max = chat.messages.length - 1;
      for (const n of idx) {
        if (typeof n !== 'number' || !Number.isInteger(n)) {
          fail(at, `msgIndex ${JSON.stringify(n)} is not an integer`);
        }
        if (n < 0 || n > max) {
          fail(
            at,
            `msgIndex ${n} is out of range - chat "${chat.slug}" has ${chat.messages.length} messages (valid 0..${max})`
          );
        }
      }
      return { type, msgIndexes: idx as number[] };
    }
    case 'lexicon': {
      const terms = raw['terms'];
      if (!Array.isArray(terms) || terms.length === 0) {
        fail(at, '"terms" must be a non-empty array');
      }
      return {
        type,
        terms: terms.map((t, j) => {
          const tAt = `${at}.terms[${j}]`;
          if (!isRecord(t)) fail(tAt, 'must be an object');
          const note = t['note'];
          if (note !== undefined && typeof note !== 'string') fail(tAt, '"note" must be a string');
          return { term: str(tAt, t, 'term'), ...(note === undefined ? {} : { note }) };
        }),
      };
    }
    default:
      fail(at, `unknown block type ${JSON.stringify(type)}`);
  }
}

/**
 * Validate an unknown value as a Report for `chat`. Throws ValidationError with a
 * descriptive message ("where: why") on the first problem found.
 */
export function validateReport(raw: unknown, chat: ParsedChat, where = 'report.json'): Report {
  if (!isRecord(raw)) fail(where, 'must be a JSON object');
  const id = str(where, raw, 'id');
  const chatSlug = str(where, raw, 'chatSlug');
  if (chatSlug !== chat.slug) {
    fail(where, `chatSlug "${chatSlug}" does not match chat slug "${chat.slug}"`);
  }
  if (raw['reportType'] !== 'classic') {
    fail(where, `reportType must be "classic" (got ${JSON.stringify(raw['reportType'])})`);
  }
  const persona = raw['persona'];
  if (!isRecord(persona)) fail(where, '"persona" must be an object');
  const blocks = raw['blocks'];
  if (!Array.isArray(blocks)) fail(where, '"blocks" must be an array');

  return {
    id,
    chatSlug,
    reportType: 'classic',
    title: str(where, raw, 'title'),
    groupName: str(where, raw, 'groupName'),
    persona: { name: str(`${where}: persona`, persona, 'name'), tagline: str(`${where}: persona`, persona, 'tagline') },
    blocks: blocks.map((b, i) => validateBlock(where, b, i, chat)),
    createdAt: str(where, raw, 'createdAt'),
  };
}
