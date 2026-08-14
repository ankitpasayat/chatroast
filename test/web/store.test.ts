import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParsedChat, Report } from '../../shared/types.js';
import {
  deleteReport,
  getChat,
  getReport,
  listReports,
  saveChat,
  saveReport,
} from '../../web/store.js';
import { loadSampleChat } from './helpers.js';

function report(id: string, over: Partial<Report> = {}): Report {
  return {
    id,
    chatSlug: 'sample-chat',
    reportType: 'classic',
    title: `Report ${id}`,
    groupName: 'Trip Council',
    persona: { name: 'Otis', tagline: 'An AI with no filter.' },
    blocks: [{ type: 'paragraph', text: 'Alright. Otis here.' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('the chats store', () => {
  let chat: ParsedChat;

  beforeAll(async () => {
    chat = await loadSampleChat();
  });

  it('round-trips a parsed chat by slug', async () => {
    await saveChat(chat);
    expect(await getChat('sample-chat')).toEqual(chat);
  });

  it('returns undefined for a chat that was never saved', async () => {
    expect(await getChat('no-such-chat')).toBeUndefined();
  });

  it('overwrites the chat when the same slug is saved again', async () => {
    await saveChat({ ...chat, groupName: 'Trip Council v2' });
    expect((await getChat('sample-chat'))?.groupName).toBe('Trip Council v2');
    await saveChat(chat);
  });
});

describe('the reports store', () => {
  it('round-trips a report by id', async () => {
    const one = report('11111111-1111-4111-8111-111111111111');
    await saveReport(one);
    expect(await getReport(one.id)).toEqual(one);
  });

  it('lists summaries newest first and drops the body', async () => {
    await saveReport(report('22222222-2222-4222-8222-222222222222', { createdAt: '2026-03-03T00:00:00.000Z' }));
    await saveReport(report('33333333-3333-4333-8333-333333333333', { createdAt: '2026-02-02T00:00:00.000Z' }));

    const list = await listReports();
    expect(list.map((r) => r.createdAt)).toEqual([...list.map((r) => r.createdAt)].sort().reverse());
    expect(list.map((r) => r.id).slice(0, 2)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(Object.keys(list[0]!).sort()).toEqual(['createdAt', 'groupName', 'id', 'title']);
  });

  it('deletes one report and leaves the others alone', async () => {
    const doomed = report('44444444-4444-4444-8444-444444444444');
    await saveReport(doomed);
    expect(await getReport(doomed.id)).toBeDefined();

    await deleteReport(doomed.id);

    expect(await getReport(doomed.id)).toBeUndefined();
    expect((await listReports()).map((r) => r.id)).not.toContain(doomed.id);
    expect(await getReport('11111111-1111-4111-8111-111111111111')).toBeDefined();
  });
});
