/**
 * The landing route: drop an export, unzip and parse it here in the browser,
 * show what was found, and keep a library of the reports stored on this device.
 */
import { parseChat } from '../src/parser/index.js';
import type { ParsedChat } from '../shared/types.js';
import { byId, el, view } from './dom.js';
import { deleteReport, listReports, saveChat } from './store.js';
import { extractChatText, formatBytes, formatRange } from './zip.js';

const TXT = /\.txt$/i;

/** Let the browser paint the status line before a synchronous unzip or parse. */
function paint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export async function mountLanding(app: HTMLElement): Promise<void> {
  app.replaceChildren(view('t-landing'));

  const dropzone = byId('dropzone');
  const fileInput = byId<HTMLInputElement>('file');
  const statusEl = byId('status');
  const errorEl = byId('error');
  const resultEl = byId('result');
  const generateLink = byId<HTMLAnchorElement>('to-generate');

  let busy = false;

  const say = (message: string): void => {
    statusEl.textContent = message;
  };

  const fail = (message: string): void => {
    errorEl.textContent = message;
    errorEl.hidden = false;
    statusEl.textContent = '';
    dropzone.classList.remove('busy');
    busy = false;
  };

  function renderStats(chat: ParsedChat): void {
    byId('stat-group').textContent = chat.groupName;
    byId('stat-count').textContent = `${chat.messageCount.toLocaleString()} messages from ${chat.senders.length} people`;
    byId('stat-range').textContent = formatRange(chat.firstTs, chat.lastTs);

    const body = byId('senders-body');
    body.replaceChildren();
    for (const sender of chat.senders.slice(0, 10)) {
      const row = el('tr');
      row.append(el('td', undefined, sender.name), el('td', undefined, sender.count.toLocaleString()));
      body.append(row);
    }
    byId('senders-table').hidden = chat.senders.length === 0;

    generateLink.href = `#/generate/${encodeURIComponent(chat.slug)}`;
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file || busy) return;
    errorEl.hidden = true;
    errorEl.textContent = '';
    resultEl.hidden = true;
    busy = true;
    dropzone.classList.add('busy');

    const isZip = /\.zip$/i.test(file.name);
    if (!isZip && !TXT.test(file.name)) {
      fail(`"${file.name}" is neither a .zip nor a .txt. Export the chat from WhatsApp and drop that file here.`);
      return;
    }

    say(`Reading ${file.name} (${formatBytes(file.size)})`);
    await paint();

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      fail('That file could not be read from disk. If it is very large, try exporting the chat without media.');
      return;
    }

    if (isZip) {
      say('Looking for the chat transcript inside the zip.');
      await paint();
    }

    let found: { name: string; text: string } | null;
    try {
      found = extractChatText(bytes, file.name);
    } catch {
      fail('That zip could not be opened. It may be incomplete, or not a WhatsApp export. Try exporting the chat again.');
      return;
    }
    if (!found) {
      fail('No chat transcript in that zip. A WhatsApp export contains a _chat.txt, or a file named "WhatsApp Chat with ...". Make sure you are dropping the file WhatsApp gave you.');
      return;
    }

    say(`Parsing ${found.name} (${formatBytes(new Blob([found.text]).size)} of text).`);
    await paint();

    let chat: ParsedChat;
    try {
      chat = parseChat(found.name, found.text);
    } catch {
      fail('That file does not look like a WhatsApp export once opened. Nothing could be parsed out of it.');
      return;
    }
    if (chat.messages.length === 0) {
      fail('That export has no messages in it.');
      return;
    }

    try {
      await saveChat(chat);
    } catch (err) {
      fail(`The chat was parsed but could not be stored in this browser. ${String(err)}`);
      return;
    }

    say(`Read ${chat.messageCount.toLocaleString()} messages. Nothing has left this page.`);
    dropzone.classList.remove('busy');
    busy = false;
    renderStats(chat);
  }

  const stop = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => {
      stop(event);
      dropzone.classList.add('dragover');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, (event) => {
      stop(event);
      dropzone.classList.remove('dragover');
    });
  }
  dropzone.addEventListener('drop', (event) => {
    void handleFile((event as DragEvent).dataTransfer?.files?.[0]);
  });
  fileInput.addEventListener('change', () => {
    const picked = fileInput.files?.[0];
    fileInput.value = ''; // so the same file can be picked twice
    void handleFile(picked);
  });

  await renderLibrary();
}

async function renderLibrary(): Promise<void> {
  const section = byId('library');
  const grid = byId('report-grid');

  let reports;
  try {
    reports = await listReports();
  } catch {
    return; // no IndexedDB (private mode, say): the library section just stays hidden
  }
  if (reports.length === 0) {
    section.hidden = true;
    return;
  }

  grid.replaceChildren();
  for (const report of reports) {
    const row = el('div', 'report-row');

    const link = el('a');
    link.href = `#/report/${encodeURIComponent(report.id)}`;
    link.append(el('span', 'rc-title', report.title));

    const when = new Date(report.createdAt);
    const date = Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    link.append(el('span', 'rc-meta', [report.groupName, date].filter(Boolean).join(' - ')));

    const del = el('button', 'btn ghost danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => {
      if (!confirm(`Delete "${report.title}"? This cannot be undone.`)) return;
      void deleteReport(report.id).then(renderLibrary);
    });

    row.append(link, del);
    grid.append(row);
  }
  section.hidden = false;
}
