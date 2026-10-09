// Builds dist/: the OpenTelemetry setup bundled into otel.js, plus the untouched page and app script.
import { copyFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/otel-setup.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  outfile: 'dist/otel.js',
  logLevel: 'info',
});
copyFileSync('src/app.js', 'dist/app.js');
copyFileSync('index.html', 'dist/index.html');
