// Example apps: `setup` installs them, `node` / `python` run one, `start` runs the mock LLM and both.
// The OpenTelemetry hookup lives here, as environment variables and start flags, never in app source.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const EX = join(ROOT, 'examples');
const WIN = process.platform === 'win32';

/** .env, then the process environment on top. */
function loadEnv() {
  /** @type {Record<string, string>} */
  const out = {};
  const file = join(ROOT, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

const env = loadEnv();
const get = (/** @type {string} */ k, /** @type {string} */ d) => (env[k] ? env[k] : d);
const OTLP_PORT = get('LIVEMAP_OTLP_PORT', '4318');
const MOCK_PORT = get('MOCK_LLM_PORT', '4599');
const NODE_PORT = get('NODE_EXAMPLE_PORT', '4501');
const PY_PORT = get('PYTHON_EXAMPLE_PORT', '4502');

/** The four hookup lines, plus log export for LLM content and the same 200 ms delay for logs. */
const HOOKUP = {
  OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${OTLP_PORT}`,
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
  OTEL_TRACES_EXPORTER: 'otlp',
  OTEL_BSP_SCHEDULE_DELAY: '200',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_BLRP_SCHEDULE_DELAY: '200',
};

/** Which LLM the examples call: the mock unless MOCK_LLM=0. */
function llmEnv() {
  if (get('MOCK_LLM', '1') !== '0') {
    return { LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`, LLM_API_KEY: 'mock-key', LLM_MODEL: 'mock-model' };
  }
  return {
    LLM_BASE_URL: get('LLM_BASE_URL', 'https://api.openai.com/v1'),
    LLM_API_KEY: get('LLM_API_KEY', ''),
    LLM_MODEL: get('LLM_MODEL', ''),
  };
}

const venvBin = (/** @type {string} */ name) =>
  join(EX, 'python-app', '.venv', WIN ? 'Scripts' : 'bin', WIN ? `${name}.exe` : name);

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, shell?: boolean}} [opts]
 */
function run(command, args, opts = {}) {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`);
  const res = spawnSync(command, args, { stdio: 'inherit', cwd: opts.cwd ?? ROOT, shell: opts.shell ?? false });
  if (res.status !== 0) {
    process.stderr.write(`Command failed (${res.status ?? res.error?.message}): ${command} ${args.join(' ')}\n`);
    process.exit(1);
  }
}

/** The first Python 3.10+ among PYTHON_BIN, python3, python and `py -3`. */
function findPython() {
  /** @type {string[][]} */
  const candidates = [];
  if (env.PYTHON_BIN) candidates.push(env.PYTHON_BIN.split(' '));
  candidates.push(['python3'], ['python'], ['py', '-3']);
  for (const [cmd, ...pre] of candidates) {
    const res = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim() === 'True') return [cmd, ...pre];
  }
  process.stderr.write('No Python 3.10 or newer found. Set PYTHON_BIN in .env.\n');
  process.exit(1);
}

function setup() {
  const npm = WIN ? 'npm.cmd' : 'npm';
  run(npm, ['install', '--no-audit', '--no-fund'], { cwd: join(EX, 'node-app'), shell: WIN });

  const [py, ...pre] = findPython();
  if (!existsSync(venvBin('python'))) run(py, [...pre, '-m', 'venv', '.venv'], { cwd: join(EX, 'python-app') });
  run(venvBin('python'), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', 'requirements.txt'], { cwd: join(EX, 'python-app') });
  run(venvBin('opentelemetry-bootstrap'), ['-a', 'install'], { cwd: join(EX, 'python-app') });

  if (existsSync(join(EX, 'browser-page', 'package.json'))) {
    run(npm, ['install', '--no-audit', '--no-fund'], { cwd: join(EX, 'browser-page'), shell: WIN });
    run(npm, ['run', 'build'], { cwd: join(EX, 'browser-page'), shell: WIN });
  }
  process.stdout.write('Examples ready. Start them with: npm run examples:start\n');
}

/**
 * @param {string} name
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string, env: Record<string, string>}} opts
 */
function start(name, command, args, opts) {
  const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code, signal) => {
    process.stderr.write(`${name} exited (${signal ?? code})\n`);
    process.exitCode = code ?? 1;
    stopAll();
  });
  children.push(child);
  return child;
}

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(), 500).unref();
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

function startMock() {
  start('mock-llm', process.execPath, [join(EX, 'mock-llm', 'server.mjs')], { cwd: ROOT, env: { MOCK_LLM_PORT: MOCK_PORT } });
}

function startNode() {
  start('node-example', process.execPath, ['--require', '@opentelemetry/auto-instrumentations-node/register', 'src/app.js'], {
    cwd: join(EX, 'node-app'),
    env: {
      ...HOOKUP,
      OTEL_SERVICE_NAME: 'node-example',
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'true',
      // Local detectors only: the default set also probes cloud metadata endpoints, which adds
      // seconds to start-up off the cloud.
      OTEL_NODE_RESOURCE_DETECTORS: 'env,host,os,process,serviceinstance',
      ...llmEnv(),
      PORT: NODE_PORT,
      PYTHON_APP_URL: `http://127.0.0.1:${PY_PORT}`,
    },
  });
}

function startPython() {
  if (!existsSync(venvBin('python'))) {
    process.stderr.write('The Python example is not set up. Run: npm run examples:setup\n');
    process.exit(1);
  }
  const cwd = join(EX, 'python-app');
  const uvicorn = [venvBin('uvicorn'), 'app.main:app', '--host', '127.0.0.1', '--port', PY_PORT];
  const pyEnv = {
    ...HOOKUP,
    OTEL_SERVICE_NAME: 'python-example',
    OTEL_SEMCONV_STABILITY_OPT_IN: 'gen_ai_latest_experimental',
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'span_only',
    ...llmEnv(),
  };
  if (!WIN) {
    start('python-example', venvBin('opentelemetry-instrument'), uvicorn, { cwd, env: pyEnv });
    return;
  }
  // On Windows `opentelemetry-instrument` ends in os.execl, which starts the app as a new process
  // and exits, leaving it unmanaged. Do what the launcher does instead: put its sitecustomize
  // folder and the working directory first on PYTHONPATH, then start uvicorn directly.
  const autoDir = join(cwd, '.venv', 'Lib', 'site-packages', 'opentelemetry', 'instrumentation', 'auto_instrumentation');
  const [command, ...args] = uvicorn;
  start('python-example', command, args, { cwd, env: { ...pyEnv, PYTHONPATH: [autoDir, cwd].join(';') } });
}

const command = process.argv[2];
if (command === 'setup') setup();
else if (command === 'node') startNode();
else if (command === 'python') startPython();
else if (command === 'mock') startMock();
else if (command === 'start') {
  startMock();
  startNode();
  startPython();
  process.stdout.write(`Mock LLM :${MOCK_PORT}, node-example :${NODE_PORT}, python-example :${PY_PORT}. Ctrl-C stops all three.\n`);
} else {
  process.stderr.write('Usage: node scripts/examples.mjs setup | start | node | python | mock\n');
  process.exit(2);
}
