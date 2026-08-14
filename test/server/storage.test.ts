import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  findReportById,
  getChatStatus,
  listChatSlugs,
  listReports,
  readChat,
  readReport,
  validateReport,
} from '../../src/server/storage.js';
import { loadSampleChat, loadSampleReport, makeWorkDir, seedChat, seedSample } from './helpers.js';

let workDir: string;

beforeAll(async () => {
  workDir = await makeWorkDir();
  await seedSample(workDir);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('valid fixtures', () => {
  it('accepts the shipped sample report', async () => {
    const bundle = await readReport('sample-chat', workDir);
    expect(bundle).not.toBeNull();
    expect(bundle!.report.id).toBe('44e64d15-6139-49cf-aaa6-40e18bad0d72');
    expect(bundle!.report.blocks.length).toBe((await loadSampleReport()).blocks.length);
    expect(bundle!.chat.messages.length).toBe(16);
  });

  it('lists chats and reports, and finds a report by id', async () => {
    expect(await listChatSlugs(workDir)).toEqual(['sample-chat']);
    const summaries = (await listReports(workDir)).map((b) => b.report.title);
    expect(summaries).toHaveLength(1);
    const found = await findReportById('44e64d15-6139-49cf-aaa6-40e18bad0d72', workDir);
    expect(found?.slug).toBe('sample-chat');
    expect(await findReportById('nope', workDir)).toBeNull();
  });

  it('reports status ready with the report id', async () => {
    expect(await getChatStatus('sample-chat', workDir)).toEqual({
      slug: 'sample-chat',
      status: 'ready',
      reportId: '44e64d15-6139-49cf-aaa6-40e18bad0d72',
    });
  });

  it('returns null for an unknown chat', async () => {
    expect(await readChat('ghost', workDir)).toBeNull();
    expect(await getChatStatus('ghost', workDir)).toBeNull();
  });
});

describe('validation rejects bad reports', () => {
  it('rejects an out-of-range msgIndex with a descriptive error', async () => {
    const chat = await loadSampleChat();
    const report = await loadSampleReport();
    const quote = report.blocks.find((b) => b.type === 'quote')!;
    if (quote.type === 'quote') quote.msgIndexes = [999];

    expect(() => validateReport(report, chat)).toThrowError(/msgIndex 999 is out of range.*valid 0\.\.15/s);
  });

  it('rejects a non-integer msgIndex', async () => {
    const chat = await loadSampleChat();
    const report = await loadSampleReport();
    const quote = report.blocks.find((b) => b.type === 'quote')!;
    if (quote.type === 'quote') quote.msgIndexes = [1.5];
    expect(() => validateReport(report, chat)).toThrowError(/is not an integer/);
  });

  it('rejects a chatSlug mismatch', async () => {
    const chat = await loadSampleChat();
    const report = await loadSampleReport();
    report.chatSlug = 'other-chat';
    expect(() => validateReport(report, chat)).toThrowError(
      /chatSlug "other-chat" does not match chat slug "sample-chat"/
    );
  });

  it('rejects an unknown block type', async () => {
    const chat = await loadSampleChat();
    const report = await loadSampleReport();
    (report.blocks as unknown[]).push({ type: 'video', src: 'x' });
    expect(() => validateReport(report, chat)).toThrowError(/unknown block type "video"/);
  });

  it('a chat whose report.json is corrupt stays pending and logs once', async () => {
    const chat = await loadSampleChat();
    chat.slug = 'broken-chat';
    const report = await loadSampleReport();
    report.chatSlug = 'broken-chat';
    const quote = report.blocks.find((b) => b.type === 'quote')!;
    if (quote.type === 'quote') quote.msgIndexes = [999];
    await seedChat(workDir, 'broken-chat', chat, report);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await readReport('broken-chat', workDir)).toBeNull();
      expect(await getChatStatus('broken-chat', workDir)).toEqual({ slug: 'broken-chat', status: 'pending' });
      // one log for the readReport call, one for the readReport inside getChatStatus
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0]![0]).toMatch(/invalid report.*msgIndex 999 is out of range/s);
    } finally {
      spy.mockRestore();
    }
    // ...and it is excluded from the valid-report listing
    expect((await listReports(workDir)).map((b) => b.slug)).toEqual(['sample-chat']);
  });

  it('rejects malformed JSON', async () => {
    const chat = await loadSampleChat();
    chat.slug = 'garbage-chat';
    await seedChat(workDir, 'garbage-chat', chat);
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await writeFile(join(workDir, 'garbage-chat', 'report.json'), '{ not json');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await readReport('garbage-chat', workDir)).toBeNull();
      expect(spy.mock.calls[0]![0]).toMatch(/invalid JSON/);
    } finally {
      spy.mockRestore();
    }
  });
});
