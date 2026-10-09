// Parses the command line once. Livemap reads no environment variables and no config file.

/**
 * @typedef {object} Options
 * @property {'serve'|'demo'|'init'|'help'} command
 * @property {number} port
 * @property {number} otlpPort
 * @property {number} maxSpans
 * @property {boolean} open
 * @property {number} seed
 * @property {number} rate
 * @property {boolean} once
 * @property {string|null} target
 */

/** @type {Record<string, {key: keyof Options, type: 'int'|'bool'|'string'}>} */
const FLAGS = {
  '--port': { key: 'port', type: 'int' },
  '--otlp-port': { key: 'otlpPort', type: 'int' },
  '--max-spans': { key: 'maxSpans', type: 'int' },
  '--open': { key: 'open', type: 'bool' },
  '--seed': { key: 'seed', type: 'int' },
  '--rate': { key: 'rate', type: 'int' },
  '--once': { key: 'once', type: 'bool' },
  '--target': { key: 'target', type: 'string' },
};

const DEMO_ONLY = new Set(['--seed', '--rate', '--once', '--target']);

export class UsageError extends Error {}

/**
 * @param {string[]} argv arguments after the script name
 * @returns {Options}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const opts = {
    command: 'serve',
    port: 4400,
    otlpPort: 4318,
    maxSpans: 5000,
    open: false,
    seed: 1,
    rate: 10,
    once: false,
    target: null,
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) {
    const cmd = args.shift();
    if (cmd === 'demo' || cmd === 'init' || cmd === 'help') opts.command = cmd;
    else throw new UsageError(`Unknown command "${cmd}". Run livemap --help.`);
  }
  while (args.length) {
    const raw = /** @type {string} */ (args.shift());
    if (raw === '--help' || raw === '-h') {
      opts.command = 'help';
      continue;
    }
    const [name, inline] = raw.includes('=') ? raw.split(/=(.*)/s, 2) : [raw, undefined];
    const flag = FLAGS[name];
    if (!flag) throw new UsageError(`Unknown option ${name}. Run livemap --help.`);
    if (DEMO_ONLY.has(name) && opts.command !== 'demo') {
      throw new UsageError(`${name} only works with "livemap demo".`);
    }
    if (flag.type === 'bool') {
      /** @type {any} */ (opts)[flag.key] = true;
      continue;
    }
    const value = inline ?? args.shift();
    if (value === undefined || value === '') throw new UsageError(`${name} needs a value.`);
    if (flag.type === 'int') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) throw new UsageError(`${name} needs a whole number, got "${value}".`);
      /** @type {any} */ (opts)[flag.key] = n;
    } else {
      /** @type {any} */ (opts)[flag.key] = value;
    }
  }
  for (const key of /** @type {const} */ (['port', 'otlpPort'])) {
    if (opts[key] < 1 || opts[key] > 65535) throw new UsageError(`Port ${opts[key]} is out of range.`);
    if (opts[key] === 4317) throw new UsageError('Port 4317 is reserved (OpenTelemetry gRPC). Choose another port.');
  }
  if (opts.maxSpans < 1) throw new UsageError('--max-spans must be at least 1.');
  if (opts.rate < 1) throw new UsageError('--rate must be at least 1.');
  if (opts.target !== null) opts.target = checkLoopbackTarget(opts.target);
  return opts;
}

/**
 * The demo only ever posts to a loopback address.
 * @param {string} target
 * @returns {string} the receiver base URL without a trailing slash
 */
export function checkLoopbackTarget(target) {
  let url;
  try {
    url = new URL(target.includes('://') ? target : `http://${target}`);
  } catch {
    throw new UsageError(`--target "${target}" is not a valid address.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || url.protocol !== 'http:') {
    throw new UsageError(`--target must be a loopback http address such as http://127.0.0.1:4318, got "${target}".`);
  }
  return `${url.protocol}//${url.host}`;
}

export const HELP = `Usage:
  livemap [--port 4400] [--otlp-port 4318] [--max-spans 5000] [--open]
  livemap demo [--seed 1] [--rate 10] [--once] [--target http://127.0.0.1:4318]
  livemap init

Starts a local OpenTelemetry receiver and a live map of your app's calls.
Everything stays on 127.0.0.1. Nothing is written to disk.`;

/**
 * @param {number} otlpPort
 * @returns {string[]}
 */
export function hookupLines(otlpPort) {
  return [
    `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${otlpPort}`,
    'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
    'OTEL_TRACES_EXPORTER=otlp',
    'OTEL_BSP_SCHEDULE_DELAY=200',
  ];
}
