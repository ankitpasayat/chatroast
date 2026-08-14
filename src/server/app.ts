/**
 * Hono routes. Portable — no Node APIs here; all I/O goes through the storage
 * module and static file serving is injected by the runtime entry (index.ts).
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { ParsedChat } from '../../shared/types.js';
import { renderIndexPlaceholder, renderNotFound, renderReport } from '../renderer/index.js';
import {
  DEFAULT_WORK_DIR,
  findReportById,
  getChatStatus,
  listReports,
  toSummary,
} from './storage.js';

export interface AppOptions {
  workDir?: string;
  /** e.g. serveStatic({ root: './public' }) from @hono/node-server. */
  staticHandler?: MiddlewareHandler;
}

type IngestChat = (filename: string, text: string, workDir: string) => Promise<ParsedChat>;

/**
 * Agent A owns src/parser/ingest.ts. The specifier is held in a variable on purpose:
 * it keeps `tsc --noEmit` green (and the server bootable) before those files land.
 * ponytail: swap to a static import once the parser is in the tree.
 */
async function loadIngest(): Promise<IngestChat | null> {
  const specifier = '../parser/ingest.js';
  try {
    const mod = (await import(specifier)) as { ingestChat?: IngestChat };
    return typeof mod.ingestChat === 'function' ? mod.ingestChat : null;
  } catch (err) {
    // Distinguishes "not written yet" from "written but broken" in the log.
    console.error(`[server] parser unavailable — ${(err as Error).message}`);
    return null;
  }
}

export function createApp(options: AppOptions = {}) {
  const workDir = options.workDir ?? process.env.WORK_DIR ?? DEFAULT_WORK_DIR;
  const app = new Hono();

  // Static first: it calls next() when the file does not exist, so the routes below
  // still win for anything public/ does not provide.
  if (options.staticHandler) app.use('/*', options.staticHandler);

  app.post('/api/chats', async (c) => {
    let body: { filename?: unknown; text?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'body must be JSON { filename, text }' }, 400);
    }
    const { filename, text } = body;
    if (typeof filename !== 'string' || typeof text !== 'string' || text.length === 0) {
      return c.json({ error: 'filename (string) and text (non-empty string) are required' }, 400);
    }

    const ingestChat = await loadIngest();
    if (!ingestChat) {
      return c.json({ error: 'parser not yet available' }, 501);
    }

    let chat: ParsedChat;
    try {
      chat = await ingestChat(filename, text, workDir);
    } catch (err) {
      return c.json({ error: `could not parse chat: ${(err as Error).message}` }, 422);
    }

    const status = (await getChatStatus(chat.slug, workDir)) ?? { slug: chat.slug, status: 'pending' as const };
    return c.json({
      ...status,
      stats: {
        groupName: chat.groupName,
        messageCount: chat.messageCount,
        senders: chat.senders,
        firstTs: chat.firstTs,
        lastTs: chat.lastTs,
      },
    });
  });

  app.get('/api/chats/:slug', async (c) => {
    const status = await getChatStatus(c.req.param('slug'), workDir);
    return status ? c.json(status) : c.json({ error: 'unknown chat' }, 404);
  });

  app.get('/api/reports', async (c) => {
    return c.json({ reports: (await listReports(workDir)).map(toSummary) });
  });

  app.get('/api/reports/:id', async (c) => {
    const bundle = await findReportById(c.req.param('id'), workDir);
    return bundle ? c.json(bundle.report) : c.json({ error: 'no such report' }, 404);
  });

  app.get('/r/:id', async (c) => {
    const bundle = await findReportById(c.req.param('id'), workDir);
    if (!bundle) return c.html(renderNotFound(), 404);
    return c.html(renderReport(bundle.report, bundle.chat));
  });

  // Fallback landing page: only reached when public/index.html is absent.
  app.get('/', async (c) => {
    return c.html(renderIndexPlaceholder((await listReports(workDir)).map(toSummary)));
  });

  app.notFound((c) => c.html(renderNotFound('That page does not exist.'), 404));

  return app;
}

export type App = ReturnType<typeof createApp>;
