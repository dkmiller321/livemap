#!/usr/bin/env node
// CLI entry: parse arguments, call into src/, print, exit codes.
import { HELP, UsageError, hookupLines, parseArgs } from '../src/cli/args.mjs';
import { initText } from '../src/cli/init.mjs';
import { openUrl } from '../src/cli/open.mjs';
import { playForever, playOnce } from '../src/demo/generator.mjs';
import { PortInUseError, startLivemap } from '../src/server/app.mjs';

/** @type {import('../src/cli/args.mjs').Options} */
let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  process.stderr.write(`${err.message}\n`);
  process.exit(2);
}

if (opts.command === 'help') {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

if (opts.command === 'init') {
  process.stdout.write(`${initText(process.cwd(), opts.otlpPort)}\n`);
  process.exit(0);
}

if (opts.command === 'demo' && opts.target) {
  await runDemo(opts.target);
} else {
  const livemap = await start();
  const pageUrl = `http://127.0.0.1:${opts.port}`;
  process.stdout.write(
    [
      `Livemap is running at ${pageUrl}`,
      '',
      'Point any OpenTelemetry SDK at it with these environment variables:',
      ...hookupLines(opts.otlpPort).map((l) => `  ${l}`),
      '',
      'Press Ctrl-C to stop.',
      '',
    ].join('\n'),
  );
  const stop = () => {
    // Exit within a second even if a connection lingers.
    setTimeout(() => process.exit(0), 500).unref();
    livemap.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (opts.open) openUrl(pageUrl);
  if (opts.command === 'demo') await runDemo(`http://127.0.0.1:${opts.otlpPort}`, true);
}

async function start() {
  try {
    return await startLivemap(opts);
  } catch (err) {
    if (!(err instanceof PortInUseError)) throw err;
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

/**
 * @param {string} target
 * @param {boolean} [keepRunning] true when this process also hosts Livemap
 */
async function runDemo(target, keepRunning = false) {
  if (opts.once) {
    try {
      await playOnce(target);
    } catch (err) {
      process.stderr.write(`Demo failed: ${/** @type {Error} */ (err).message}\n`);
      process.exit(1);
    }
    process.stdout.write(`Demo played: 3 traces, 27 spans sent to ${target}\n`);
    if (!keepRunning) process.exit(0);
    return;
  }
  process.stdout.write(`Demo playing about ${opts.rate} spans per second to ${target} (seed ${opts.seed}). Ctrl-C to stop.\n`);
  const demo = playForever({
    target,
    rate: opts.rate,
    seed: opts.seed,
    onError: (err) => process.stderr.write(`Demo: ${err.message}\n`),
  });
  if (!keepRunning) {
    const stop = () => {
      demo.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}
