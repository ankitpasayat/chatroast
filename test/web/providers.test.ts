import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ParsedChat } from '../../shared/types.js';
import { generateReport } from '../../web/providers.js';
import type { Settings } from '../../web/settings.js';
import { loadPersona, loadSampleChat } from './helpers.js';

// ------------------------------------------------------------------ fixtures

const ANTHROPIC: Settings = {
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-5',
  apiKey: 'sk-ant-test',
  remember: false,
};

const OPENROUTER: Settings = {
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'anthropic/claude-sonnet-4.5',
  apiKey: 'sk-or-test',
  remember: false,
};

let chat: ParsedChat;
let persona: string;

beforeAll(async () => {
  chat = await loadSampleChat();
  persona = await loadPersona();
});

function reportJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: '44e64d15-6139-49cf-aaa6-40e18bad0d72',
    chatSlug: 'sample-chat',
    reportType: 'classic',
    title: 'Nobody has ever booked the villa - a report on Trip Council',
    groupName: 'Trip Council',
    persona: { name: 'Otis', tagline: 'An AI with no filter.' },
    blocks: [
      { type: 'paragraph', text: 'Alright. Otis here.' },
      { type: 'quote', msgIndexes: [4, 5] },
    ],
    createdAt: '2026-08-14T00:00:00.000Z',
    ...over,
  });
}

// --------------------------------------------------------------- SSE plumbing

/** Deliver a payload as a stream cut at boundaries that ignore event framing. */
function streamOf(payload: string, chunkSize = 37): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < payload.length; i += chunkSize) {
        controller.enqueue(encoder.encode(payload.slice(i, i + chunkSize)));
      }
      controller.close();
    },
  });
}

function sseResponse(events: string[]): Response {
  return new Response(streamOf(events.join('')), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Split text into a handful of pieces so delta assembly is actually exercised. */
function pieces(text: string, n = 5): string[] {
  const size = Math.ceil(text.length / n);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function anthropicSse(text: string, stopReason = 'end_turn'): Response {
  return sseResponse([
    event('message_start', { type: 'message_start', message: { id: 'msg_1', role: 'assistant' } }),
    event('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    ...pieces(text).map((p) =>
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: p },
      }),
    ),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason } }),
    event('message_stop', { type: 'message_stop' }),
  ]);
}

function openAiSse(text: string): Response {
  return sseResponse([
    ...pieces(text).map(
      (p) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p } }] })}\n\n`,
    ),
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ]);
}

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(...responses: Response[]): FetchMock {
  const fetchMock = vi.fn();
  for (const res of responses) fetchMock.mockResolvedValueOnce(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callOf(fetchMock: FetchMock, i: number): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const call = fetchMock.mock.calls[i] as [string, RequestInit] | undefined;
  if (!call) throw new Error(`fetch was not called ${i + 1} times`);
  const [url, init] = call;
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------- adapter

describe('the Anthropic adapter', () => {
  it('posts to /v1/messages with the browser-access header and a streaming body', async () => {
    const fetchMock = mockFetch(anthropicSse(reportJson()));

    const report = await generateReport(chat, ANTHROPIC, () => {}, persona);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, headers, body } = callOf(fetchMock, 0);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['content-type']).toBe('application/json');
    expect(headers['Authorization']).toBeUndefined();

    expect(body['model']).toBe('claude-opus-5');
    expect(body['max_tokens']).toBe(16000);
    expect(body['stream']).toBe(true);
    const messages = body['messages'] as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toContain('"chatSlug": "sample-chat"');
    expect(messages[0]!.content).toContain('[1] Maya: manifesting goa 2024');

    expect(report.title).toBe('Nobody has ever booked the villa - a report on Trip Council');
    expect(report.chatSlug).toBe('sample-chat');
  });

  it('does not double up the version segment when the base URL already has /v1', async () => {
    const fetchMock = mockFetch(anthropicSse(reportJson()));
    await generateReport(chat, { ...ANTHROPIC, baseUrl: 'https://api.anthropic.com/v1/' }, () => {}, persona);
    expect(callOf(fetchMock, 0).url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('reports a refusal in plain words', async () => {
    mockFetch(anthropicSse('I will not do that.', 'refusal'));
    await expect(generateReport(chat, ANTHROPIC, () => {}, persona)).rejects.toThrow(/refused/i);
  });

  it('surfaces the provider error message on a non-2xx reply', async () => {
    mockFetch(
      new Response(JSON.stringify({ type: 'error', error: { message: 'invalid x-api-key' } }), {
        status: 401,
      }),
    );
    await expect(generateReport(chat, ANTHROPIC, () => {}, persona)).rejects.toThrow(
      /invalid x-api-key/,
    );
  });
});

describe('the OpenAI-compatible adapter', () => {
  it('posts to /chat/completions with a Bearer key and a minimal body', async () => {
    const fetchMock = mockFetch(openAiSse(reportJson()));

    await generateReport(chat, OPENROUTER, () => {}, persona);

    const { url, headers, body } = callOf(fetchMock, 0);
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headers['Authorization']).toBe('Bearer sk-or-test');
    expect(headers['x-api-key']).toBeUndefined();

    expect(body['model']).toBe('anthropic/claude-sonnet-4.5');
    expect(body['stream']).toBe(true);
    // maximum compatibility: nothing exotic in the body
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('sends no Authorization header when the local runtime needs no key', async () => {
    const fetchMock = mockFetch(openAiSse(reportJson()));
    await generateReport(
      chat,
      { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama', apiKey: '', remember: false },
      () => {},
      persona,
    );
    const { url, headers } = callOf(fetchMock, 0);
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('streaming', () => {
  it('assembles the deltas and reports progress cumulatively', async () => {
    const json = reportJson();
    mockFetch(anthropicSse(json));

    const seen: string[] = [];
    const report = await generateReport(chat, ANTHROPIC, (text) => seen.push(text), persona);

    expect(seen.length).toBeGreaterThan(2);
    expect(seen[seen.length - 1]).toBe(json);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.startsWith(seen[i - 1]!)).toBe(true);
      expect(seen[i]!.length).toBeGreaterThan(seen[i - 1]!.length);
    }
    expect(report.blocks).toHaveLength(2);
  });

  it('parses a reply wrapped in a markdown fence and prose', async () => {
    mockFetch(openAiSse(`Sure, here is the report:\n\n\`\`\`json\n${reportJson()}\n\`\`\`\n\nEnjoy.`));

    const report = await generateReport(chat, OPENROUTER, () => {}, persona);
    expect(report.title).toBe('Nobody has ever booked the villa - a report on Trip Council');
  });
});

describe('validation and repair', () => {
  it('asks once for a fix when a quote points outside the chat, and accepts the fix', async () => {
    const broken = reportJson({
      blocks: [
        { type: 'paragraph', text: 'Alright. Otis here.' },
        { type: 'quote', msgIndexes: [999] },
      ],
    });
    const fetchMock = mockFetch(anthropicSse(broken), anthropicSse(reportJson()));

    const report = await generateReport(chat, ANTHROPIC, () => {}, persona);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry = callOf(fetchMock, 1);
    const messages = retry.body['messages'] as { role: string; content: string }[];
    expect(messages).toHaveLength(3);
    expect(messages[1]!.role).toBe('assistant');
    expect(messages[1]!.content).toBe(broken);
    expect(messages[2]!.role).toBe('user');
    expect(messages[2]!.content).toContain('failed validation');
    expect(messages[2]!.content).toContain('msgIndex 999 is out of range');

    expect(report.blocks[1]).toEqual({ type: 'quote', msgIndexes: [4, 5] });
  });

  it('gives up after one repair and throws carrying the validation message', async () => {
    const broken = reportJson({ blocks: [{ type: 'quote', msgIndexes: [999] }] });
    const fetchMock = mockFetch(anthropicSse(broken), anthropicSse(broken));

    await expect(generateReport(chat, ANTHROPIC, () => {}, persona)).rejects.toThrow(
      /msgIndex 999 is out of range/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('repairs a reply that is not JSON at all', async () => {
    const fetchMock = mockFetch(anthropicSse('I would rather write a poem.'), anthropicSse(reportJson()));
    const report = await generateReport(chat, ANTHROPIC, () => {}, persona);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(report.reportType).toBe('classic');
  });

  it('overrides the fields a model drifts on instead of failing', async () => {
    mockFetch(
      anthropicSse(
        reportJson({
          id: 'not-a-uuid',
          chatSlug: 'some-other-chat',
          reportType: 'deluxe',
          persona: { name: 'Brandon', tagline: 'An AI with no filter.' },
        }),
      ),
    );

    const report = await generateReport(chat, ANTHROPIC, () => {}, persona);
    expect(report.chatSlug).toBe('sample-chat');
    expect(report.reportType).toBe('classic');
    expect(report.persona.name).toBe('Otis');
    expect(report.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('says so when the model returns nothing', async () => {
    mockFetch(anthropicSse(''));
    await expect(generateReport(chat, ANTHROPIC, () => {}, persona)).rejects.toThrow(
      /returned nothing/i,
    );
  });
});
