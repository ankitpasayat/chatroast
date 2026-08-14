/**
 * Filesystem storage backend. ALL Node-specific I/O for the app lives here so the
 * Hono routes stay portable (a Workers/KV backend can implement the same functions).
 *
 * Layout: <workDir>/<slug>/chat.json | report.json (see shared/types.ts).
 * Nothing is cached: every call re-reads disk, so a report.json dropped in while the
 * server is running goes live on the next request.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Block, ParsedChat, Report } from '../../shared/types.js';

export interface ReportSummary {
  id: string;
  title: string;
  groupName: string;
  createdAt: string;
}

export interface ReportBundle {
  slug: string;
  report: Report;
  chat: ParsedChat;
}

export const DEFAULT_WORK_DIR = './work';

class ValidationError extends Error {}

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
            `msgIndex ${n} is out of range — chat "${chat.slug}" has ${chat.messages.length} messages (valid 0..${max})`
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
 * Validate an unknown value as a Report for `chat`. Throws Error with a descriptive
 * message ("where: why") on the first problem found.
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

async function readJson(path: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null; // absent (or unreadable) — treated the same: nothing there yet
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ValidationError(`${path}: invalid JSON — ${(err as Error).message}`);
  }
}

/** Slugs of every chat directory in workDir (dir containing a chat.json is enough). */
export async function listChatSlugs(workDir: string = DEFAULT_WORK_DIR): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(workDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

export async function readChat(slug: string, workDir: string = DEFAULT_WORK_DIR): Promise<ParsedChat | null> {
  const path = join(workDir, slug, 'chat.json');
  try {
    const raw = await readJson(path);
    if (raw === null) return null;
    if (!isRecord(raw) || !Array.isArray(raw['messages'])) fail(path, 'not a ParsedChat (missing messages[])');
    return raw as unknown as ParsedChat;
  } catch (err) {
    console.error(`[storage] ${(err as Error).message}`);
    return null;
  }
}

/**
 * Read + validate <slug>/report.json against <slug>/chat.json.
 * Returns null when absent OR invalid; an invalid report is logged once per read
 * (the chat then simply stays 'pending').
 */
export async function readReport(slug: string, workDir: string = DEFAULT_WORK_DIR): Promise<ReportBundle | null> {
  const chat = await readChat(slug, workDir);
  if (!chat) return null;
  const path = join(workDir, slug, 'report.json');
  try {
    const raw = await readJson(path);
    if (raw === null) return null;
    return { slug, chat, report: validateReport(raw, chat, path) };
  } catch (err) {
    console.error(`[storage] invalid report — ${(err as Error).message}`);
    return null;
  }
}

/** Every valid report, newest first. */
export async function listReports(workDir: string = DEFAULT_WORK_DIR): Promise<ReportBundle[]> {
  const slugs = await listChatSlugs(workDir);
  const bundles = await Promise.all(slugs.map((s) => readReport(s, workDir)));
  return bundles
    .filter((b): b is ReportBundle => b !== null)
    .sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt));
}

export function toSummary(bundle: ReportBundle): ReportSummary {
  const { id, title, groupName, createdAt } = bundle.report;
  return { id, title, groupName, createdAt };
}

export async function findReportById(id: string, workDir: string = DEFAULT_WORK_DIR): Promise<ReportBundle | null> {
  for (const slug of await listChatSlugs(workDir)) {
    const bundle = await readReport(slug, workDir);
    if (bundle && bundle.report.id === id) return bundle;
  }
  return null;
}

/** Chat status per the API contract: 'ready' iff a VALID report.json exists. */
export async function getChatStatus(
  slug: string,
  workDir: string = DEFAULT_WORK_DIR
): Promise<{ slug: string; status: 'pending' | 'ready'; reportId?: string } | null> {
  const chat = await readChat(slug, workDir);
  if (!chat) return null;
  const bundle = await readReport(slug, workDir);
  return bundle ? { slug, status: 'ready', reportId: bundle.report.id } : { slug, status: 'pending' };
}
