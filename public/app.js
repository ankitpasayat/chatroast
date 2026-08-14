// chatroast — landing page.
// Plain ES modules, no build step. The chat .zip is opened in the browser;
// only the extracted chat text is ever sent to the server.

import { unzipSync } from './vendor/fflate.js';

const TXT = /\.txt$/i;
const CHAT_HINT = /WhatsApp Chat|_chat/i;

const basename = (p) => p.split('/').pop();

const decode = (bytes) => {
  const s = new TextDecoder('utf-8').decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; // strip BOM
};

/**
 * Pull the chat transcript out of a WhatsApp export.
 *
 * `bytes` is the whole file; `filename` decides how it is read. A `.txt` is
 * returned as-is; anything else is treated as a zip and only .txt entries are
 * decompressed — fflate's filter skips the media without inflating it, so a
 * 150 MB export costs about as much as a 150 KB one.
 *
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @returns {{ name: string, text: string } | null} null when the zip holds no
 *          identifiable chat transcript.
 */
export function extractChatText(bytes, filename) {
  if (TXT.test(filename)) return { name: basename(filename), text: decode(bytes) };

  const entries = unzipSync(bytes, {
    filter: (f) =>
      TXT.test(f.name) &&
      !f.name.startsWith('__MACOSX/') &&
      !basename(f.name).startsWith('.'),
  });

  const names = Object.keys(entries);
  if (names.length === 0) return null;

  const pick =
    names.find((n) => basename(n).toLowerCase() === '_chat.txt') ||
    names.find((n) => CHAT_HINT.test(basename(n))) ||
    (names.length === 1 ? names[0] : null);

  if (!pick) return null; // several .txt files, none of them obviously the chat
  return { name: basename(pick), text: decode(entries[pick]) };
}

/** 1234567 -> "1.2 MB" */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** ISO timestamps -> "12 Nov 2023 – 4 Jan 2026" */
export function formatRange(firstTs, lastTs) {
  const fmt = (ts) => {
    const d = new Date(ts);
    return Number.isNaN(d.getTime())
      ? String(ts ?? '').slice(0, 10)
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  if (!firstTs && !lastTs) return '—';
  return `${fmt(firstTs)} – ${fmt(lastTs)}`;
}

// ---------------------------------------------------------------- page wiring

const POLL_MS = 5000;

function init() {
  const $ = (id) => document.getElementById(id);
  const dropzone = $('dropzone');
  const fileInput = $('file');
  const statusEl = $('status');
  const errorEl = $('error');
  const resultEl = $('result');
  const pendingEl = $('state-pending');
  const readyEl = $('state-ready');
  const reportLink = $('report-link');

  let pollTimer = null;
  let busy = false;

  const say = (msg) => { statusEl.textContent = msg; };

  const fail = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    statusEl.textContent = '';
    dropzone.classList.remove('busy');
    busy = false;
  };

  const clearError = () => { errorEl.hidden = true; errorEl.textContent = ''; };

  // let the browser paint the status line before a synchronous unzip
  const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  async function readJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  function showReady(reportId) {
    pendingEl.hidden = true;
    readyEl.hidden = false;
    reportLink.href = `/r/${encodeURIComponent(reportId)}`;
  }

  function poll(slug) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      let data;
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(slug)}`);
        if (!res.ok) return; // transient — keep waiting quietly
        data = await res.json();
      } catch {
        return;
      }
      if (data && data.status === 'ready' && data.reportId) {
        clearInterval(pollTimer);
        showReady(data.reportId);
      }
    }, POLL_MS);
  }

  function renderStats(stats) {
    $('stat-group').textContent = stats?.groupName || 'Unknown group';
    $('stat-count').textContent =
      typeof stats?.messageCount === 'number'
        ? `${stats.messageCount.toLocaleString()} messages`
        : '—';
    $('stat-range').textContent = formatRange(stats?.firstTs, stats?.lastTs);

    const table = $('senders-table');
    const body = $('senders-body');
    body.replaceChildren();
    const senders = Array.isArray(stats?.senders) ? stats.senders.slice(0, 10) : [];
    for (const s of senders) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = s.name;
      const count = document.createElement('td');
      count.textContent = Number(s.count).toLocaleString();
      tr.append(name, count);
      body.append(tr);
    }
    table.hidden = senders.length === 0;
  }

  async function upload(name, text) {
    say(`Sending ${name} to Otis (${formatBytes(new Blob([text]).size)})…`);

    let res;
    try {
      res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: name, text }),
      });
    } catch {
      fail('Could not reach the server. If you are previewing these files statically, start the app with `npm run dev` and try again.');
      return;
    }

    if (!res.ok) {
      const body = await readJson(res);
      const detail = body && (body.error || body.message);
      fail(
        res.status === 404
          ? 'The upload endpoint is not available on this server (404). Start the app with `npm run dev` to process chats.'
          : `The server could not process that chat (${res.status}). ${detail || 'Try another export.'}`
      );
      return;
    }

    const data = await readJson(res);
    if (!data || !data.slug) {
      fail('The server sent back something unexpected. Try again, or check the server log.');
      return;
    }

    say(`Read ${name} — done.`);
    dropzone.classList.remove('busy');
    busy = false;

    renderStats(data.stats);
    resultEl.hidden = false;

    if (data.status === 'ready' && data.reportId) {
      showReady(data.reportId);
    } else {
      readyEl.hidden = true;
      pendingEl.hidden = false;
      poll(data.slug);
    }
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleFile(file) {
    if (!file || busy) return;
    clearInterval(pollTimer);
    clearError();
    resultEl.hidden = true;
    pendingEl.hidden = true;
    readyEl.hidden = true;
    busy = true;
    dropzone.classList.add('busy');

    const isZip = /\.zip$/i.test(file.name);
    const isTxt = TXT.test(file.name);
    if (!isZip && !isTxt) {
      fail(`“${file.name}” is neither a .zip nor a .txt. Export the chat from WhatsApp and drop that file here.`);
      return;
    }

    say(isZip
      ? `Reading zip (${formatBytes(file.size)})…`
      : `Reading ${file.name} (${formatBytes(file.size)})…`);
    await paint();

    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      fail('That file could not be read from disk. If it is very large, try exporting the chat without media.');
      return;
    }

    if (isZip) { say('Looking for the chat transcript…'); await paint(); }

    let found;
    try {
      found = extractChatText(bytes, file.name);
    } catch {
      fail('That zip could not be opened — it may be incomplete or not a WhatsApp export. Try exporting the chat again.');
      return;
    }

    if (!found) {
      fail('No chat transcript found in that zip. A WhatsApp export contains a _chat.txt (or “WhatsApp Chat with …”.txt) — make sure you are uploading the file WhatsApp gave you.');
      return;
    }

    say(`Found ${found.name} (${formatBytes(new Blob([found.text]).size)}).`);
    await paint();
    await upload(found.name, found.text);
  }

  // drag & drop
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (e) => { stop(e); dropzone.classList.add('dragover'); });
  }
  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, (e) => { stop(e); dropzone.classList.remove('dragover'); });
  }
  dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));
  // the whole window swallows stray drops so the browser never navigates away
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = ''; // allow re-picking the same file
    handleFile(f);
  });

  loadReports();

  async function loadReports() {
    let reports;
    try {
      const res = await fetch('/api/reports');
      if (!res.ok) return; // no server / not implemented yet: section stays hidden
      const data = await res.json();
      reports = data?.reports;
    } catch {
      return;
    }
    if (!Array.isArray(reports) || reports.length === 0) return;

    const grid = $('report-grid');
    grid.replaceChildren();
    for (const r of reports) {
      const a = document.createElement('a');
      a.className = 'report-card';
      a.href = `/r/${encodeURIComponent(r.id)}`;

      const title = document.createElement('span');
      title.className = 'rc-title';
      title.textContent = r.title || 'Untitled report';

      const meta = document.createElement('span');
      meta.className = 'rc-meta';
      const when = r.createdAt ? new Date(r.createdAt) : null;
      const date = when && !Number.isNaN(when.getTime())
        ? when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      meta.textContent = [r.groupName, date].filter(Boolean).join(' · ');

      a.append(title, meta);
      grid.append(a);
    }
    $('reports').hidden = false;
  }
}

if (typeof document !== 'undefined') init();
