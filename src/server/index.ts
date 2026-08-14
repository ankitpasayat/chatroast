/** Node entry point: the only file that knows about ports, disk paths and process. */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { DEFAULT_WORK_DIR } from './storage.js';

const port = Number(process.env.PORT ?? 8787);
const workDir = process.env.WORK_DIR ?? DEFAULT_WORK_DIR;

const app = createApp({
  workDir,
  staticHandler: serveStatic({ root: './public' }),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`wa-export-report listening on http://localhost:${info.port} (work dir: ${workDir})`);
});
