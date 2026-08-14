// Builds the static site into site/: one bundle, one stylesheet, one page.
// Deliberately unminified, because the whole pitch is that you can read the
// deployed code and see where your API key goes. Every asset reference in
// index.html is relative, so the site works from a project subpath such as
// https://<user>.github.io/chatroast/.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = dirname(fileURLToPath(import.meta.url));
const siteDir = join(webDir, '..', 'site');

await mkdir(join(siteDir, 'assets'), { recursive: true });

await build({
  entryPoints: [join(webDir, 'main.ts')],
  outfile: join(siteDir, 'assets', 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: false,
  sourcemap: true,
  // keep the inlined persona spec legible instead of a wall of \u escapes;
  // module scripts are decoded as UTF-8 no matter what the server says
  charset: 'utf8',
  // shared/persona.md is inlined into the bundle as a string
  loader: { '.md': 'text' },
  logLevel: 'info',
});

await copyFile(join(webDir, 'index.html'), join(siteDir, 'index.html'));
await copyFile(join(webDir, 'style.css'), join(siteDir, 'style.css'));

console.log('site/ built: index.html, style.css, assets/app.js');
