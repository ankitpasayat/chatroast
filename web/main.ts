/**
 * chatroast, static build. Four hash routes, no framework, no server.
 * This is the only module that pulls in the persona spec, which esbuild inlines
 * as text at build time.
 */
import personaText from '../shared/persona.md';
import { byId, fatal } from './dom.js';
import { mountGenerate } from './view-generate.js';
import { mountLanding } from './view-landing.js';
import { mountReport } from './view-report.js';
import { mountSettingsPage } from './view-settings.js';

async function route(): Promise<void> {
  const app = byId('app');
  const path = location.hash.replace(/^#/, '');
  const [head = '', tail = ''] = path.split('/').filter((part) => part !== '');
  app.className = head === 'report' ? 'column wide' : 'column';

  if (head === 'settings') {
    mountSettingsPage(app);
    return;
  }
  if (head === 'generate' && tail !== '') {
    await mountGenerate(app, decodeURIComponent(tail), personaText);
    return;
  }
  if (head === 'report' && tail !== '') {
    await mountReport(app, decodeURIComponent(tail));
    return;
  }
  await mountLanding(app);
}

/**
 * The toggle is one long-lived element (its listeners survive re-renders);
 * each view render moves it into that view's nav row, left of the links.
 */
function placeThemeToggle(): void {
  const btn = byId<HTMLButtonElement>('theme-toggle');
  const home = document.querySelector('.topnav') ?? document.querySelector('.report-bar') ?? byId('app');
  home.prepend(btn);
  btn.hidden = false;
}

async function render(): Promise<void> {
  try {
    await route();
  } catch (err) {
    fatal(byId('app'), `Something in this page broke: ${err instanceof Error ? err.message : String(err)}`);
  }
  placeThemeToggle();
  window.scrollTo({ top: 0 });
}

/**
 * The page follows the system color scheme until the toggle is used once; from
 * then on the stored choice wins (html.dark / html.light, applied before first
 * paint by the inline bootstrap in index.html). The switch itself is a
 * full-page cross-fade via the View Transitions API; browsers without it, and
 * reduced-motion users, switch instantly.
 */
function wireThemeToggle(): void {
  const btn = byId<HTMLButtonElement>('theme-toggle');
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const isDark = (): boolean =>
    root.classList.contains('dark') || (!root.classList.contains('light') && systemDark.matches);
  const sync = (): void => {
    btn.setAttribute('aria-pressed', String(isDark()));
    btn.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  };

  btn.addEventListener('click', () => {
    const next = !isDark();
    const apply = (): void => {
      root.classList.toggle('dark', next);
      root.classList.toggle('light', !next);
      try {
        localStorage.setItem('chatroast.theme', next ? 'dark' : 'light');
      } catch {
        // Storage disabled: the choice just does not survive a reload.
      }
      sync();
    };
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown })
      .startViewTransition;
    if (typeof vt === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      vt.call(document, apply);
    } else {
      apply();
    }
  });
  systemDark.addEventListener('change', sync);
  sync();
}

window.addEventListener('hashchange', () => void render());

// A stray file dropped outside the drop zone must not navigate the page away.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

wireThemeToggle();
void render();
