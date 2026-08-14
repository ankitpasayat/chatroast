/**
 * The provider settings form. Mounted on its own route and, when something is
 * still missing, inline on the generate screen.
 */
import { byId, el, view } from './dom.js';
import { listModels } from './providers.js';
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
  const modelsBtn = byId<HTMLButtonElement>('f-models');
  const modelsList = byId<HTMLDataListElement>('models-list');
  const modelsStatus = byId('models-status');
  const keyHelp = byId('key-help');
  const modelBlock = byId('model-block');

  /** No point offering model choice before the thing it needs: a key (where required). */
  const syncModelBlock = (): void => {
    modelBlock.hidden =
      key.value.trim() === '' && !providerOf(select.value as ProviderId).keyOptional;
  };

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

    keyHelp.replaceChildren();
    if (p.keyUrl !== '') {
      const link = el('a', undefined, p.keyUrl.replace(/^https:\/\//, ''));
      link.href = p.keyUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      keyHelp.append(
        p.keyOptional
          ? 'No key to create. Local server setup and CORS guide: '
          : `New to ${p.label}? Keys are created in your account at `,
        link,
      );
    }
  };

  const fill = (s: Settings): void => {
    select.value = s.provider;
    base.value = s.baseUrl;
    model.value = s.model;
    key.value = s.apiKey;
    remember.checked = s.remember;
    applyPreset(providerOf(s.provider));
    syncModelBlock();
  };

  key.addEventListener('input', syncModelBlock);

  fill(loadSettings());

  select.addEventListener('change', () => {
    const p = providerOf(select.value as ProviderId);
    base.value = p.baseUrl;
    model.value = p.model;
    applyPreset(p);
    status.textContent = '';
    modelsList.replaceChildren();
    modelsStatus.textContent = '';
    syncModelBlock();
  });

  modelsBtn.addEventListener('click', () => {
    const p = providerOf(select.value as ProviderId);
    if (base.value.trim() === '') {
      modelsStatus.textContent = 'Set the base URL first.';
      return;
    }
    if (key.value.trim() === '' && !p.keyOptional) {
      modelsStatus.textContent = `Add your ${p.label} API key above: the model list is behind it.`;
      return;
    }
    modelsBtn.disabled = true;
    modelsStatus.textContent = `Asking ${p.label} for its model list...`;
    void listModels({
      provider: p.id,
      baseUrl: base.value.trim(),
      model: model.value.trim(),
      apiKey: key.value.trim(),
      remember: remember.checked,
    })
      .then((ids) => {
        modelsList.replaceChildren(
          ...ids.map((id) => {
            const opt = document.createElement('option');
            opt.value = id;
            return opt;
          }),
        );
        modelsStatus.textContent =
          ids.length === 0
            ? `${p.label} listed no models for this key.`
            : `${ids.length} models listed. Click into the model field, or start typing, to pick one.`;
      })
      .catch((err: unknown) => {
        modelsStatus.textContent = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        modelsBtn.disabled = false;
      });
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
