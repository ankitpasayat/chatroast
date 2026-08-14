import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParsedChat, Report } from '../../shared/types.js';

const FIXTURES = new URL('../../fixtures/', import.meta.url);

export async function loadSampleChat(): Promise<ParsedChat> {
  return JSON.parse(await readFile(new URL('sample-chat.json', FIXTURES), 'utf8')) as ParsedChat;
}

export async function loadSampleReport(): Promise<Report> {
  return JSON.parse(await readFile(new URL('sample-report.json', FIXTURES), 'utf8')) as Report;
}

/** Fresh temp work dir. */
export async function makeWorkDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wa-report-test-'));
}

/** Write work/<slug>/chat.json (+ report.json when given). */
export async function seedChat(
  workDir: string,
  slug: string,
  chat: ParsedChat,
  report?: unknown
): Promise<void> {
  const dir = join(workDir, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'chat.json'), JSON.stringify(chat, null, 2));
  if (report !== undefined) {
    await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  }
}

/** Copy the shipped fixtures into <workDir>/sample-chat/. */
export async function seedSample(workDir: string): Promise<{ chat: ParsedChat; report: Report }> {
  const chat = await loadSampleChat();
  const report = await loadSampleReport();
  await seedChat(workDir, chat.slug, chat, report);
  return { chat, report };
}

export const XSS_TEXT = `<script>alert("pwn")</script> & **not bold** <img src=x onerror=alert(1)>`;

/** Sample chat + one crafted hostile message appended, and a report quoting it. */
export async function seedXss(workDir: string, slug = 'xss-chat'): Promise<{ id: string; index: number }> {
  const chat = await loadSampleChat();
  chat.slug = slug;
  const index = chat.messages.length;
  chat.messages.push({ index, ts: '2026-06-01T10:00:00', sender: 'Mallory', kind: 'text', text: XSS_TEXT });
  const id = '11111111-2222-3333-4444-555555555555';
  const report: Report = {
    id,
    chatSlug: slug,
    reportType: 'classic',
    title: 'Hostile input <b>test</b>',
    groupName: 'Trip Council',
    persona: { name: 'Otis', tagline: 'tagline' },
    blocks: [{ type: 'quote', msgIndexes: [index] }],
    createdAt: '2026-08-14T00:00:00Z',
  };
  await seedChat(workDir, slug, chat, report);
  return { id, index };
}
