import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
await build({ entryPoints: ['web/app.ts'], bundle: true, outdir: 'dist/dashboard', format: 'esm',
  target: ['es2022'], minify: true, loader: { '.png': 'file', '.woff2': 'file' }, assetNames: 'assets/[name]-[hash]', logLevel: 'info' });
mkdirSync('dist/dashboard', { recursive: true });
copyFileSync('web/index.html', 'dist/dashboard/index.html');
