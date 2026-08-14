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

async function render(): Promise<void> {
  try {
    await route();
  } catch (err) {
    fatal(byId('app'), `Something in this page broke: ${err instanceof Error ? err.message : String(err)}`);
  }
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => void render());

// A stray file dropped outside the drop zone must not navigate the page away.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

void render();
