/**
 * Provider configuration. Everything here lives in this browser only: the
 * non-secret fields in localStorage under one key, the API key either alongside
 * them (when the user ticks "remember") or in this module for the session.
 */

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'xai'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

/** Wire format. Everything that is not Anthropic speaks the OpenAI chat shape. */
export type ApiFlavor = 'anthropic' | 'openai';

export interface Provider {
  id: ProviderId;
  label: string;
  api: ApiFlavor;
  baseUrl: string;
  /** Prefilled model, empty when the provider has no obvious default. */
  model: string;
  modelPlaceholder: string;
  /** Local runtimes usually accept any key, or none. */
  keyOptional: boolean;
  help: string;
}

const ANY_MODEL = 'model id, e.g. as listed by your provider';

export const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5',
    modelPlaceholder: 'claude-opus-5',
    keyOptional: false,
    help: 'claude-opus-5 writes the best reports. claude-sonnet-5 is the cheaper alternative and still very good.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    modelPlaceholder: ANY_MODEL,
    keyOptional: false,
    help: 'Any chat model your key can reach. Pick one with a large context window: a year of group chat is a lot of tokens.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    modelPlaceholder: ANY_MODEL,
    keyOptional: false,
    help: 'Model ids look like vendor/model, for example anthropic/claude-sonnet-4.5. OpenRouter is the easiest way to reach almost any model from a browser.',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    api: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: '',
    modelPlaceholder: ANY_MODEL,
    keyOptional: false,
    help: 'Model ids look like grok-4.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    api: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    modelPlaceholder: ANY_MODEL,
    keyOptional: true,
    help: 'Runs on your own machine, so nothing leaves it. No key needed. Set OLLAMA_ORIGINS so the browser is allowed to call it, and use a model with a big context window.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    api: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    modelPlaceholder: ANY_MODEL,
    keyOptional: true,
    help: 'Runs on your own machine, so nothing leaves it. No key needed. Start the local server and enable CORS in its settings.',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    api: 'openai',
    baseUrl: '',
    model: '',
    modelPlaceholder: ANY_MODEL,
    keyOptional: true,
    help: 'Any endpoint that implements POST /chat/completions the way OpenAI does. Give the base URL up to and including /v1.',
  },
];

export interface Settings {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  remember: boolean;
}

export const SETTINGS_KEY = 'chatroast.settings';

export function providerOf(id: ProviderId): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

export function defaultSettings(): Settings {
  const p = PROVIDERS[0]!;
  return { provider: p.id, baseUrl: p.baseUrl, model: p.model, apiKey: '', remember: false };
}

/** Key held for this page session only, when "remember" is off. */
let sessionKey = '';

function readStore(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function pickString(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : fallback;
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  const stored = readStore();
  const id = pickString(stored, 'provider', base.provider) as ProviderId;
  const provider = PROVIDERS.some((p) => p.id === id) ? id : base.provider;
  const preset = providerOf(provider);
  const remember = stored['remember'] === true;
  return {
    provider,
    baseUrl: pickString(stored, 'baseUrl', preset.baseUrl),
    model: pickString(stored, 'model', preset.model),
    apiKey: remember ? pickString(stored, 'apiKey', '') : sessionKey,
    remember,
  };
}

export function saveSettings(s: Settings): void {
  sessionKey = s.remember ? '' : s.apiKey;
  const record: Record<string, unknown> = {
    provider: s.provider,
    baseUrl: s.baseUrl,
    model: s.model,
    remember: s.remember,
  };
  if (s.remember) record['apiKey'] = s.apiKey;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(record));
  } catch {
    // Storage disabled or full: the settings simply do not survive a reload.
  }
}

/** Drop the key from both memory and storage, keeping the rest of the config. */
export function forgetKey(): Settings {
  sessionKey = '';
  const next = { ...loadSettings(), apiKey: '', remember: false };
  saveSettings(next);
  return next;
}

/** Null when generation can be attempted, otherwise what is still missing. */
export function settingsProblem(s: Settings): string | null {
  const preset = providerOf(s.provider);
  if (s.baseUrl.trim() === '') return 'Set the base URL for your provider.';
  if (s.model.trim() === '') return 'Set the model id you want to use.';
  if (s.apiKey.trim() === '' && !preset.keyOptional) return `Add your ${preset.label} API key.`;
  return null;
}

/** USD per million tokens, only for the models this page can price honestly. */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
};

export function priceOf(s: Settings): { in: number; out: number } | null {
  if (s.provider !== 'anthropic') return null;
  return PRICES[s.model.trim()] ?? null;
}
