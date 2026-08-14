/**
 * The generate route: what this will cost, then one streamed API call, then
 * straight to the finished report.
 */
import { renderTranscript } from '../shared/transcript.js';
import type { ParsedChat } from '../shared/types.js';
import { byId, fatal, view } from './dom.js';
import { MAX_TOKENS, generateReport } from './providers.js';
import { type Settings, loadSettings, priceOf, providerOf, settingsProblem } from './settings.js';
import { getChat, saveReport } from './store.js';
import { mountSettingsForm } from './view-settings.js';
import { formatBytes } from './zip.js';

const PHASES = [
  'Otis is reading your chat.',
  'Otis is working out who talks the most.',
  'Otis is deciding which of you is the problem.',
  'Otis is drafting the Roster.',
  'Otis is picking quotes. Real ones only.',
  'Otis is handing out the Awards.',
  'Otis is being unnecessarily specific about you.',
  'Otis is still writing. Long chats take a while.',
];

function money(usd: number): string {
  return usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export async function mountGenerate(
  app: HTMLElement,
  slug: string,
  personaText: string,
): Promise<void> {
  let loaded: ParsedChat | undefined;
  try {
    loaded = await getChat(slug);
  } catch (err) {
    fatal(app, `This browser would not open its database. ${String(err)}`);
    return;
  }
  if (!loaded) {
    fatal(app, `No chat called "${slug}" is stored in this browser. Drop the export in again.`);
    return;
  }
  const chat = loaded;

  app.replaceChildren(view('t-generate'));

  const transcript = renderTranscript(chat);
  const tokens = Math.round(transcript.length / 4);

  byId('g-group').textContent = chat.groupName;
  byId('g-count').textContent = `${chat.messageCount.toLocaleString()} messages from ${chat.senders.length} people`;
  byId('g-size').textContent = `${formatBytes(new Blob([transcript]).size)}, roughly ${tokens.toLocaleString()} input tokens`;

  const runBtn = byId<HTMLButtonElement>('g-run');
  const noteEl = byId('g-note');
  const costEl = byId('g-cost');
  const progressEl = byId('g-progress');
  const phaseEl = byId('g-phase');
  const metricsEl = byId('g-metrics');
  const errorEl = byId('g-error');
  const settingsSlot = byId('g-settings-slot');

  function showPlan(settings: Settings): void {
    const price = priceOf(settings);
    costEl.textContent = price
      ? `${money((tokens / 1e6) * price.in)} of input, plus up to ${money((MAX_TOKENS / 1e6) * price.out)} of output: ${money((tokens / 1e6) * price.in + (MAX_TOKENS / 1e6) * price.out)} at the very most`
      : `No estimate. This page only prices claude-opus-5 and claude-sonnet-5 on Anthropic; multiply ${tokens.toLocaleString()} tokens by your provider's input rate.`;

    const problem = settingsProblem(settings);
    noteEl.textContent = problem
      ? `${problem} The whole transcript goes to that provider in one request.`
      : `One request to ${providerOf(settings.provider).label}, model ${settings.model}, sent from this page with your key. The whole transcript goes with it.`;
    runBtn.disabled = problem !== null;
    // Reveal the inline form when something is missing, but never yank it away
    // from under someone who is still filling it in.
    if (problem !== null) settingsSlot.hidden = false;
  }

  const settingsAtLoad = loadSettings();
  showPlan(settingsAtLoad);
  if (settingsProblem(settingsAtLoad) !== null) {
    mountSettingsForm(settingsSlot, showPlan);
  }

  runBtn.addEventListener('click', () => {
    const settings = loadSettings();
    const problem = settingsProblem(settings);
    if (problem !== null) {
      showPlan(settings);
      return;
    }

    errorEl.hidden = true;
    errorEl.textContent = '';
    runBtn.disabled = true;
    runBtn.textContent = 'Generating';
    progressEl.hidden = false;
    phaseEl.textContent = PHASES[0]!;
    metricsEl.textContent = 'Waiting for the first words.';

    const started = Date.now();
    let words = 0;
    let phase = 0;

    const metricsTimer = window.setInterval(() => {
      if (!progressEl.isConnected) return window.clearInterval(metricsTimer);
      const seconds = Math.round((Date.now() - started) / 1000);
      metricsEl.textContent = `${words.toLocaleString()} words written, ${seconds}s elapsed`;
    }, 500);

    const phaseTimer = window.setInterval(() => {
      if (!progressEl.isConnected) return window.clearInterval(phaseTimer);
      phase = (phase + 1) % PHASES.length;
      phaseEl.textContent = PHASES[phase]!;
    }, 4500);

    void generateReport(chat, settings, (text) => {
      words = countWords(text);
    }, personaText)
      .then(async (report) => {
        await saveReport(report);
        location.hash = `#/report/${encodeURIComponent(report.id)}`;
      })
      .catch((err: unknown) => {
        errorEl.textContent = `${err instanceof Error ? err.message : String(err)}\n\nNothing was saved. You can try again, or change provider and try again.`;
        errorEl.hidden = false;
        progressEl.hidden = true;
        runBtn.disabled = false;
        runBtn.textContent = 'Try again';
        settingsSlot.hidden = false;
        if (settingsSlot.childElementCount === 0) mountSettingsForm(settingsSlot, showPlan);
      })
      .finally(() => {
        window.clearInterval(metricsTimer);
        window.clearInterval(phaseTimer);
      });
  });
}
