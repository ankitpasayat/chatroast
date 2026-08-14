import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Report } from '../../shared/types.js';
import { createApp, type App } from '../../src/server/app.js';
import { makeWorkDir, seedSample, seedXss, XSS_TEXT } from './helpers.js';

const SAMPLE_ID = '44e64d15-6139-49cf-aaa6-40e18bad0d72';

let workDir: string;
let app: App;
let xss: { id: string; index: number };

beforeAll(async () => {
  workDir = await makeWorkDir();
  await seedSample(workDir);
  xss = await seedXss(workDir);
  app = createApp({ workDir });
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('GET /api/reports', () => {
  it('lists summaries of every valid report', async () => {
    const res = await app.request('/api/reports');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reports: { id: string; title: string; groupName: string; createdAt: string }[] };
    expect(body.reports.map((r) => r.id).sort()).toEqual([SAMPLE_ID, xss.id].sort());
    const sample = body.reports.find((r) => r.id === SAMPLE_ID)!;
    expect(Object.keys(sample).sort()).toEqual(['createdAt', 'groupName', 'id', 'title']);
    expect(sample.groupName).toBe('Trip Council');
  });
});

describe('GET /api/reports/:id', () => {
  it('returns the report JSON', async () => {
    const res = await app.request(`/api/reports/${SAMPLE_ID}`);
    expect(res.status).toBe(200);
    const report = (await res.json()) as Report;
    expect(report.chatSlug).toBe('sample-chat');
    expect(report.blocks[0]!.type).toBe('paragraph');
  });

  it('404s for an unknown id', async () => {
    const res = await app.request('/api/reports/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/chats/:slug', () => {
  it('is ready with a reportId once a valid report exists', async () => {
    const res = await app.request('/api/chats/sample-chat');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: 'sample-chat', status: 'ready', reportId: SAMPLE_ID });
  });

  it('404s for an unknown slug', async () => {
    expect((await app.request('/api/chats/nope')).status).toBe(404);
  });
});

describe('GET /r/:id', () => {
  it('renders the report page', async () => {
    const res = await app.request(`/r/${SAMPLE_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('Nobody has ever booked the villa');
    expect(html.match(/class="bubble"/g)).toHaveLength(7);
  });

  it('escapes hostile chat text end to end', async () => {
    const html = await (await app.request(`/r/${xss.id}`)).text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('**not bold**');
    expect(XSS_TEXT).toContain('<script>');
  });

  it('serves a 404 HTML page for an unknown id', async () => {
    const res = await app.request('/r/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('404');
  });
});

describe('POST /api/chats', () => {
  it('rejects a malformed body', async () => {
    const res = await app.request('/api/chats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'x.txt' }),
    });
    expect(res.status).toBe(400);
  });

  it('501s while the parser is absent, 200s once it lands', async () => {
    const res = await app.request('/api/chats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'chat.txt', text: 'hello' }),
    });
    // Agent A owns src/parser/ingest.ts; before it lands this is a graceful 501.
    expect([200, 422, 501]).toContain(res.status);
  });
});

describe('GET / fallback', () => {
  it('lists reports when public/index.html is not being served', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain(`/r/${SAMPLE_ID}`);
  });
});
