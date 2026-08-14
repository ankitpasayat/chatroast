/**
 * The provider settings form. Mounted on its own route and, when something is
 * still missing, inline on the generate screen.
 */
import { byId, el, view } from './dom.js';
import {
  PROVIDERS,
  type Provider,
  type ProviderId,
  type Settings,
  forgetKey,
  loadSettings,
  providerOf,
  saveSettings,
  settingsProblem,
} from './settings.js';

export function mountSettingsForm(host: HTMLElement, onSaved?: (s: Settings) => void): void {
  host.replaceChildren(view('t-settings'));

  const form = byId<HTMLFormElement>('settings-form');
  const select = byId<HTMLSelectElement>('f-provider');
  const base = byId<HTMLInputElement>('f-base');
  const model = byId<HTMLInputElement>('f-model');
  const key = byId<HTMLInputElement>('f-key');
  const remember = byId<HTMLInputElement>('f-remember');
  const showBtn = byId<HTMLButtonElement>('f-show');
  const forgetBtn = byId<HTMLButtonElement>('f-forget');
  const status = byId('f-status');
  const help = byId('model-help');

  for (const p of PROVIDERS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    select.append(opt);
  }

  const applyPreset = (p: Provider): void => {
    model.placeholder = p.modelPlaceholder;
    key.placeholder = p.keyOptional ? 'usually not needed for a local server' : 'paste your key';
    help.textContent = p.help;
  };

  const fill = (s: Settings): void => {
    select.value = s.provider;
    base.value = s.baseUrl;
    model.value = s.model;
    key.value = s.apiKey;
    remember.checked = s.remember;
    applyPreset(providerOf(s.provider));
  };

  fill(loadSettings());

  select.addEventListener('change', () => {
    const p = providerOf(select.value as ProviderId);
    base.value = p.baseUrl;
    model.value = p.model;
    applyPreset(p);
    status.textContent = '';
  });

  showBtn.addEventListener('click', () => {
    const hidden = key.type === 'password';
    key.type = hidden ? 'text' : 'password';
    showBtn.textContent = hidden ? 'Hide' : 'Show';
    showBtn.setAttribute('aria-pressed', String(hidden));
  });

  forgetBtn.addEventListener('click', () => {
    const next = forgetKey();
    fill(next);
    status.textContent = 'Key forgotten. It is gone from this browser and from memory.';
    onSaved?.(next);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next: Settings = {
      provider: select.value as ProviderId,
      baseUrl: base.value.trim(),
      model: model.value.trim(),
      apiKey: key.value.trim(),
      remember: remember.checked,
    };
    saveSettings(next);
    fill(loadSettings());

    const problem = settingsProblem(next);
    const stored = next.apiKey === ''
      ? 'Saved.'
      : next.remember
        ? "Saved. The key is in this browser's local storage until you forget it."
        : 'Saved. The key stays in memory until you close this tab.';
    status.textContent = problem ? `${stored} Still missing: ${problem}` : stored;
    onSaved?.(next);
  });
}

/** The #/settings route: a way back, then the same form. */
export function mountSettingsPage(app: HTMLElement): void {
  const nav = el('nav', 'topnav');
  const back = el('a', undefined, 'Back');
  back.href = '#/';
  nav.append(back);

  const host = el('section');
  app.replaceChildren(nav, host);
  mountSettingsForm(host);
}
