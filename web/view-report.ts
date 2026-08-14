/**
 * The report route. The renderer emits a complete standalone HTML document, so
 * it goes into a sandboxed iframe as-is: scripts are blocked in there, and the
 * exact same bytes are what the Download button hands over.
 */
import { renderReport } from '../src/renderer/index.js';
import { byId, fatal, view } from './dom.js';
import { deleteReport, getChat, getReport } from './store.js';

function download(html: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function mountReport(app: HTMLElement, id: string): Promise<void> {
  const report = await getReport(id).catch(() => undefined);
  if (!report) {
    fatal(app, 'That report is not stored in this browser. It may have been deleted, or written on another device.');
    return;
  }
  const chat = await getChat(report.chatSlug).catch(() => undefined);
  if (!chat) {
    fatal(app, `The chat "${report.chatSlug}" this report quotes is no longer stored here, so its quotes cannot be printed.`);
    return;
  }

  const html = renderReport(report, chat);

  app.replaceChildren(view('t-report'));
  const frame = byId<HTMLIFrameElement>('r-frame');
  frame.srcdoc = html;

  byId('r-download').addEventListener('click', () => {
    download(html, `${report.chatSlug || 'chatroast'}-report.html`);
  });

  byId('r-print').addEventListener('click', () => {
    const win = frame.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  });

  byId('r-delete').addEventListener('click', () => {
    if (!confirm(`Delete "${report.title}"? This cannot be undone.`)) return;
    void deleteReport(report.id).then(() => {
      location.hash = '#/';
    });
  });
}
