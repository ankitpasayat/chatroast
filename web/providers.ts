/**
 * The one place this page talks to a network. Two wire formats: the native
 * Anthropic Messages API, and the OpenAI chat-completions shape that everyone
 * else implements. Both stream, so the page can show progress.
 *
 * The request goes to the base URL in the user's settings and nowhere else.
 */
import type { ParsedChat, Report } from '../shared/types.js';
import { ValidationError, validateReport } from '../shared/validate.js';
import { OTIS, buildPrompt, repairInstruction } from './prompt.js';
import { type Settings, providerOf } from './settings.js';

/** Enough for a 4,000 word report with room to spare. */
export const MAX_TOKENS = 16000;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Called with everything the model has written so far. */
export type DeltaFn = (fullText: string) => void;

/** The model replied, but not with a usable report. Worth one repair attempt. */
export class ReplyProblem extends Error {}

interface StreamResult {
  text: string;
  /** Anthropic stop_reason or OpenAI finish_reason, when the provider sent one. */
  stopReason: string | null;
}

// ------------------------------------------------------------------ utilities

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function strOf(o: Record<string, unknown> | null, key: string): string | null {
  const v = o?.[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Anthropic paths already carry /v1, so a base of ".../v1" must not double up. */
function anthropicBase(url: string): string {
  return trimSlash(url).replace(/\/v1$/, '');
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Plain http on a LAN is not a secure context, so randomUUID may be missing.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  try {
    return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    throw new Error(
      `Could not reach ${url}. Either you are offline, or the provider is refusing requests that come from a browser (CORS). Details: ${String(err)}`,
    );
  }
}

/** Human-readable message for a non-2xx reply, using the body's own wording. */
async function httpError(res: Response, label: string): Promise<Error> {
  const body = await res.text().catch(() => '');
  const parsed = (() => {
    try {
      return obj(JSON.parse(body));
    } catch {
      return null;
    }
  })();
  const errVal = parsed?.['error'];
  const detail =
    (typeof errVal === 'string' ? errVal : strOf(obj(errVal), 'message')) ??
    strOf(parsed, 'message') ??
    body.slice(0, 300).trim();

  const hint =
    res.status === 401 || res.status === 403
      ? `${label} did not accept that API key`
      : res.status === 404
        ? `${label} has no endpoint at that URL, so the base URL or the model id is probably wrong`
        : res.status === 429
          ? `${label} is rate limiting you, or the account is out of credit`
          : `${label} returned an error`;
  return new Error(`${hint} (HTTP ${res.status}). ${detail}`);
}

/** Yield raw SSE event blocks (everything between blank lines). */
async function* sseEvents(res: Response): AsyncGenerator<string> {
  const body = res.body;
  if (!body) throw new Error('The provider replied without a body, so there was nothing to read.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split(/\r?\n\r?\n/);
    buf = parts.pop() ?? '';
    for (const part of parts) if (part.trim() !== '') yield part;
  }
  buf += decoder.decode();
  if (buf.trim() !== '') yield buf;
}

/** The `data:` payload of an SSE block, or null for comments and bare events. */
function dataOf(block: string): string | null {
  const lines = block
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  return lines.length === 0 ? null : lines.join('\n');
}

function parseEvent(payload: string): Record<string, unknown> | null {
  try {
    return obj(JSON.parse(payload));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- adapters

async function callAnthropic(
  settings: Settings,
  turns: ChatTurn[],
  onDelta: DeltaFn,
): Promise<StreamResult> {
  const res = await post(
    `${anthropicBase(settings.baseUrl)}/v1/messages`,
    {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    {
      model: settings.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
    },
  );
  if (!res.ok) throw await httpError(res, 'Anthropic');

  let text = '';
  let stopReason: string | null = null;

  for await (const block of sseEvents(res)) {
    const payload = dataOf(block);
    if (payload === null) continue;
    const ev = parseEvent(payload);
    if (!ev) continue;

    if (ev['type'] === 'error') {
      throw new Error(strOf(obj(ev['error']), 'message') ?? 'The provider reported an error.');
    }
    if (ev['type'] === 'content_block_delta') {
      const delta = obj(ev['delta']);
      const chunk = delta?.['type'] === 'text_delta' ? strOf(delta, 'text') : null;
      if (chunk !== null) {
        text += chunk;
        onDelta(text);
      }
    }
    if (ev['type'] === 'message_delta') {
      stopReason = strOf(obj(ev['delta']), 'stop_reason') ?? stopReason;
    }
  }
  return { text, stopReason };
}

async function callOpenAiCompatible(
  settings: Settings,
  turns: ChatTurn[],
  onDelta: DeltaFn,
): Promise<StreamResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Local runtimes are usually keyless; sending an empty Bearer upsets some of them.
  if (settings.apiKey.trim() !== '') headers['Authorization'] = `Bearer ${settings.apiKey}`;

  // No response_format and no temperature: the more exotic the body, the more
  // OpenAI-compatible servers reject it outright.
  const res = await post(`${trimSlash(settings.baseUrl)}/chat/completions`, headers, {
    model: settings.model,
    stream: true,
    messages: turns.map((t) => ({ role: t.role, content: t.content })),
  });
  if (!res.ok) throw await httpError(res, providerOf(settings.provider).label);

  let text = '';
  let stopReason: string | null = null;

  for await (const block of sseEvents(res)) {
    const payload = dataOf(block);
    if (payload === null || payload === '[DONE]') continue;
    const ev = parseEvent(payload);
    if (!ev) continue;

    const errVal = ev['error'];
    if (errVal !== undefined && errVal !== null) {
      throw new Error(
        (typeof errVal === 'string' ? errVal : strOf(obj(errVal), 'message')) ??
          'The provider reported an error mid-stream.',
      );
    }

    const choices = ev['choices'];
    const choice = Array.isArray(choices) ? obj(choices[0]) : null;
    if (!choice) continue;
    const chunk = strOf(obj(choice['delta']), 'content');
    if (chunk !== null) {
      text += chunk;
      onDelta(text);
    }
    stopReason = strOf(choice, 'finish_reason') ?? stopReason;
  }
  return { text, stopReason };
}

function callProvider(settings: Settings, turns: ChatTurn[], onDelta: DeltaFn): Promise<StreamResult> {
  return providerOf(settings.provider).api === 'anthropic'
    ? callAnthropic(settings, turns, onDelta)
    : callOpenAiCompatible(settings, turns, onDelta);
}

// ------------------------------------------------------------ reply -> Report

/** The JSON object in a reply, fences and stray chatter stripped. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new ReplyProblem('the reply did not contain a JSON object at all');
  }
  return body.slice(start, end + 1);
}

/** Repair the fields a model reliably drifts on before validation sees them. */
function coerce(raw: unknown, chat: ParsedChat): unknown {
  const r = obj(raw);
  if (!r) return raw;
  r['chatSlug'] = chat.slug;
  r['reportType'] = 'classic';
  r['persona'] = {
    name: OTIS.name,
    tagline: strOf(obj(r['persona']), 'tagline') ?? OTIS.tagline,
  };
  const id = strOf(r, 'id');
  if (id === null || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    r['id'] = newId();
  }
  if (strOf(r, 'groupName') === null) r['groupName'] = chat.groupName;
  if (strOf(r, 'createdAt') === null) r['createdAt'] = new Date().toISOString();
  return r;
}

function reportFrom(result: StreamResult, chat: ParsedChat): Report {
  if (result.stopReason === 'refusal') {
    throw new Error(
      'The model refused to write this report. Some providers will not roast real people. Try a different model or provider.',
    );
  }
  if (result.text.trim() === '') {
    throw new Error(
      'The model returned nothing at all. Check that the model id exists on this provider, then try again.',
    );
  }
  const json = extractJson(result.text);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new ReplyProblem(
      result.stopReason === 'length' || result.stopReason === 'max_tokens'
        ? `the reply was cut off at the output limit, so the JSON is incomplete (${String(err)})`
        : `the reply is not valid JSON (${String(err)})`,
    );
  }
  return validateReport(coerce(raw, chat), chat, 'report');
}

function repairable(err: unknown): err is Error {
  return err instanceof ReplyProblem || err instanceof ValidationError;
}

/**
 * Prompt -> stream -> Report, with one automatic repair round trip when the
 * model's first attempt does not validate. Throws an Error whose message is
 * meant to be shown to the user as-is.
 */
export async function generateReport(
  chat: ParsedChat,
  settings: Settings,
  onDelta: DeltaFn,
  personaText: string,
): Promise<Report> {
  const turns: ChatTurn[] = [{ role: 'user', content: buildPrompt(chat, personaText) }];

  const first = await callProvider(settings, turns, onDelta);
  try {
    return reportFrom(first, chat);
  } catch (err) {
    if (!repairable(err)) throw err;

    const retry = await callProvider(
      settings,
      [
        ...turns,
        { role: 'assistant', content: first.text },
        { role: 'user', content: repairInstruction(err.message) },
      ],
      onDelta,
    );
    try {
      return reportFrom(retry, chat);
    } catch (err2) {
      if (!repairable(err2)) throw err2;
      throw new Error(
        `The model sent back a report that does not fit this chat, twice. Last problem: ${err2.message}`,
      );
    }
  }
}
