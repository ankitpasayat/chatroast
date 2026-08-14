/**
 * The storage promise the trust notice makes: the key is written to this
 * browser only when "remember" is ticked, and never after "Forget key".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROVIDERS,
  SETTINGS_KEY,
  type Settings,
  defaultSettings,
  forgetKey,
  loadSettings,
  priceOf,
  providerOf,
  saveSettings,
  settingsProblem,
} from '../../web/settings.js';

/** Stand-in for the one real boundary this module has. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

let storage: Storage;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
  // clear the module's in-memory key between tests
  forgetKey();
  storage.clear();
});

const withKey: Settings = {
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-5',
  apiKey: 'sk-ant-secret',
  remember: false,
};

describe('defaults', () => {
  it('starts on the Anthropic preset', () => {
    const s = defaultSettings();
    expect(s.provider).toBe('anthropic');
    expect(s.baseUrl).toBe('https://api.anthropic.com');
    expect(s.model).toBe('claude-opus-5');
    expect(s.apiKey).toBe('');
    expect(s.remember).toBe(false);
  });

  it('offers every provider the page claims to support, with editable presets', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual([
      'anthropic',
      'openai',
      'openrouter',
      'xai',
      'ollama',
      'lmstudio',
      'custom',
    ]);
    expect(providerOf('openai').baseUrl).toBe('https://api.openai.com/v1');
    expect(providerOf('openrouter').baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(providerOf('xai').baseUrl).toBe('https://api.x.ai/v1');
    expect(providerOf('ollama').baseUrl).toBe('http://localhost:11434/v1');
    expect(providerOf('lmstudio').baseUrl).toBe('http://localhost:1234/v1');
    expect(providerOf('anthropic').help).toContain('claude-sonnet-5');
    // only Anthropic ships a default model; the rest are free text
    expect(PROVIDERS.filter((p) => p.model !== '').map((p) => p.id)).toEqual(['anthropic']);
    expect(providerOf('openai').modelPlaceholder).toContain('model id');
  });
});

describe('the key', () => {
  it('is never written to storage when "remember" is off', () => {
    saveSettings(withKey);
    expect(storage.getItem(SETTINGS_KEY)).not.toContain('sk-ant-secret');
    expect(JSON.parse(String(storage.getItem(SETTINGS_KEY)))).not.toHaveProperty('apiKey');
    // still usable for this session
    expect(loadSettings().apiKey).toBe('sk-ant-secret');
  });

  it('is written to storage when "remember" is on', () => {
    saveSettings({ ...withKey, remember: true });
    expect(JSON.parse(String(storage.getItem(SETTINGS_KEY)))['apiKey']).toBe('sk-ant-secret');
    expect(loadSettings().apiKey).toBe('sk-ant-secret');
  });

  it('does not survive a reload when it was only held in memory', () => {
    saveSettings(withKey);
    const reloaded = JSON.parse(String(storage.getItem(SETTINGS_KEY))) as Record<string, unknown>;
    // a fresh page sees only what is in storage
    expect(reloaded['apiKey']).toBeUndefined();
    expect(reloaded['model']).toBe('claude-opus-5');
  });

  it('is gone from memory and storage after Forget key', () => {
    saveSettings({ ...withKey, remember: true });
    const after = forgetKey();
    expect(after.apiKey).toBe('');
    expect(after.remember).toBe(false);
    expect(String(storage.getItem(SETTINGS_KEY))).not.toContain('sk-ant-secret');
    expect(loadSettings().apiKey).toBe('');
    // the rest of the config is kept
    expect(loadSettings().model).toBe('claude-opus-5');
  });

  it('survives a storage that refuses to write', () => {
    vi.stubGlobal('localStorage', {
      ...fakeStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => saveSettings(withKey)).not.toThrow();
  });
});

describe('settingsProblem', () => {
  it('names what is missing before a run can start', () => {
    expect(settingsProblem({ ...withKey, apiKey: '' })).toContain('Anthropic API key');
    expect(settingsProblem({ ...withKey, model: '  ' })).toContain('model id');
    expect(settingsProblem({ ...withKey, baseUrl: '' })).toContain('base URL');
    expect(settingsProblem(withKey)).toBeNull();
  });

  it('lets a local runtime run without a key', () => {
    expect(
      settingsProblem({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3.1',
        apiKey: '',
        remember: false,
      }),
    ).toBeNull();
  });
});

describe('priceOf', () => {
  it('prices only the two Anthropic models it knows', () => {
    expect(priceOf(withKey)).toEqual({ in: 5, out: 25 });
    expect(priceOf({ ...withKey, model: 'claude-sonnet-5' })).toEqual({ in: 3, out: 15 });
    expect(priceOf({ ...withKey, model: 'claude-something-else' })).toBeNull();
    expect(priceOf({ ...withKey, provider: 'openrouter', model: 'claude-opus-5' })).toBeNull();
  });
});
