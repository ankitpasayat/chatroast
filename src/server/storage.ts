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
import type { ParsedChat, Report } from '../../shared/types.js';
import { ValidationError, validateReport } from '../../shared/validate.js';

export { validateReport };

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

async function readJson(path: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null; // absent (or unreadable) - treated the same: nothing there yet
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ValidationError(`${path}: invalid JSON - ${(err as Error).message}`);
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
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !Array.isArray((raw as Record<string, unknown>)['messages'])
    ) {
      throw new ValidationError(`${path}: not a ParsedChat (missing messages[])`);
    }
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
    console.error(`[storage] invalid report - ${(err as Error).message}`);
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
