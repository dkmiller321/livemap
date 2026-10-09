// Records a narrated demo video of Livemap.
//
//   node scripts/record-demo.mjs            # voice-over from ElevenLabs (needs ELEVENLABS_API_KEY in .env)
//   node scripts/record-demo.mjs --silent   # timing run with silent placeholder audio, no API calls
//
// Steps: synthesise each narration line (cached in demo-out/audio, so re-takes are free), start Livemap
// and the examples, drive the page with Playwright while recording, pacing each scene to its line, then
// lay the lines over the video with ffmpeg. Output: demo-out/livemap-demo.mp4 and a matching .srt.
// Dev tooling only: uses the Playwright dev dependency and ffmpeg from PATH.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'demo-out');
const AUDIO = join(OUT, 'audio');
const WIN = process.platform === 'win32';
const SILENT = process.argv.includes('--silent');
const VIEW = { width: 1600, height: 900 };
const GAP_MS = 700;
const LIVEMAP = 'http://127.0.0.1:4400';
const NODE_APP = 'http://127.0.0.1:4501';

const env = loadEnv();
const VOICE = env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const MODEL = env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

/**
 * @typedef {object} Scene
 * @property {string} id
 * @property {string} text what the voice says
 * @property {(s: Stage) => Promise<void>} act what happens on screen while it is said
 */

/**
 * @typedef {object} Stage
 * @property {import('@playwright/test').Page} page
 * @property {(target: import('@playwright/test').Locator) => Promise<void>} click
 * @property {(target: import('@playwright/test').Locator) => Promise<void>} point
 * @property {{start: (rate: number) => void, stop: () => void}} demo
 */

/** @type {Scene[]} */
const SCENES = [
  {
    id: 'intro',
    text:
      "This is Livemap. It shows any running app as a live, animated map. With nothing connected, it waits for traffic, and shows the four environment variables that hook up any OpenTelemetry app.",
    async act({ page, point }) {
      await sleep(1500);
      await point(page.getByTestId('hookup-lines'));
    },
  },
  {
    id: 'demo',
    text:
      "Here's the built-in demo: a small shop with a browser, two services, Postgres, Redis, a queue and a worker, and an AI agent calling a model. Every call is a particle that travels for as long as the call took. Failures flash red.",
    async act({ page, demo, point }) {
      demo.start(10);
      await sleep(5000);
      await point(page.locator('[data-testid="node"][data-node-id="openai"]'));
      await sleep(2500);
      await point(page.locator('[data-testid="node"][data-node-id="postgresql"]'));
    },
  },
  {
    id: 'detail',
    text:
      "Pause freezes the view while spans keep arriving. Click any call to see what was sent and what came back. For this LLM call: the model, the token counts, the system prompt, the question, and the answer.",
    async act({ page, click }) {
      await click(page.getByTestId('pause-button'));
      await sleep(800);
      const id = await answeredLlmRow(page);
      await click(page.locator(`[data-testid="feed-row"][data-span-id="${id}"]`));
      await sleep(1500);
      await scrollPanelTo(page, '[data-section="llm"]');
    },
  },
  {
    id: 'waterfall',
    text: "Below that is the whole request as a waterfall, from the click in the browser down to the database, with this call highlighted.",
    async act({ page }) {
      await scrollPanelTo(page, '[data-testid="waterfall"]');
    },
  },
  {
    id: 'hide',
    text: "Sharing your screen? Hide content masks prompts, responses, SQL and query strings with one switch.",
    async act({ page, click }) {
      await scrollPanelTo(page, '[data-section="llm"]');
      await click(page.getByTestId('hide-content-toggle'));
      await sleep(2500);
      await click(page.getByTestId('hide-content-toggle'));
    },
  },
  {
    id: 'filters',
    text: "Filter the feed by kind, show only errors, or click a node to see just its traffic.",
    async act({ page, click, point }) {
      await page.keyboard.press('Escape');
      await point(page.getByTestId('filter-kind'));
      await page.getByTestId('filter-kind').selectOption('llm');
      await sleep(1500);
      await page.getByTestId('filter-kind').selectOption('all');
      await click(page.getByTestId('filter-errors'));
      await sleep(1500);
      await click(page.getByTestId('filter-errors'));
      await click(page.locator('[data-testid="node"][data-node-id="postgresql"]'));
      await sleep(1800);
      await click(page.getByTestId('filter-chip-clear'));
      await click(page.getByTestId('pause-button'));
    },
  },
  {
    id: 'apps',
    text:
      "Now two real apps, unmodified: an Express app in Node and a FastAPI app in Python, hooked up with environment variables alone. One request crosses both services, queries SQLite and asks a model, and it's on the map in under a second.",
    async act({ page, click, demo }) {
      demo.stop();
      await sleep(600);
      await click(page.getByTestId('clear-button'));
      await sleep(1200);
      await fetch(`${NODE_APP}/order/1042`);
      await sleep(3500);
      await fetch(`${NODE_APP}/hello`);
      await sleep(2500);
      await fetch(`${NODE_APP}/order/1042`);
    },
  },
  {
    id: 'python-llm',
    text: "Here's the Python app's LLM call, with its prompt and reply, captured by OpenTelemetry's own instrumentation.",
    async act({ page, click }) {
      const row = page.locator('[data-testid="feed-row"][data-kind="llm"]').filter({ hasText: 'python-example' }).first();
      await click(row);
      await sleep(1200);
      await scrollPanelTo(page, '[data-section="llm"]');
    },
  },
  {
    id: 'outro',
    text: "Livemap runs on your own machine with one command. No account, nothing written to disk, and nothing sent anywhere.",
    async act({ page }) {
      await page.keyboard.press('Escape');
      await sleep(600);
      await fetch(`${NODE_APP}/order/1042`);
    },
  },
];

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(AUDIO, { recursive: true });
  need('ffmpeg');
  need('ffprobe');
  if (!SILENT && !env.ELEVENLABS_API_KEY) {
    fail('ELEVENLABS_API_KEY is not set. Add it to .env (git-ignored), or run with --silent for a timing run.');
  }
  for (const port of [4400, 4318, 4501, 4502, 4599]) {
    if (await portOpen(port)) fail(`Port ${port} is in use. Stop Livemap and the examples first.`);
  }

  console.log(SILENT ? 'Placeholder audio (silent run)…' : `Voice-over from ElevenLabs (voice ${VOICE}, model ${MODEL})…`);
  const clips = [];
  for (const [i, scene] of SCENES.entries()) {
    const file = SILENT ? await silentClip(scene) : await speak(scene, SCENES[i - 1]?.text, SCENES[i + 1]?.text);
    clips.push({ scene, file, ms: durationMs(file) });
    console.log(`  ${scene.id.padEnd(11)} ${(durationMs(file) / 1000).toFixed(1)} s`);
  }

  const procs = startServices();
  try {
    await waitFor(`${LIVEMAP}/healthz`);
    for (const url of [`${NODE_APP}/healthz`, 'http://127.0.0.1:4502/healthz', 'http://127.0.0.1:4599/healthz']) await waitFor(url, 60_000);
    await sleep(2000); // let the examples' start-up spans land, then clear them
    await fetch(`${LIVEMAP}/api/clear`, { method: 'POST' });
    const { video, timeline } = await record(clips);
    mux(video, timeline);
  } finally {
    procs.stop();
  }
}

/**
 * @param {{scene: Scene, file: string, ms: number}[]} clips
 */
async function record(clips) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 1,
    recordVideo: { dir: join(OUT, 'raw'), size: VIEW },
  });
  await context.addInitScript(cursorScript);
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(LIVEMAP);
  await page.getByTestId('connection-status').getByText('Live').waitFor();

  /** @type {import('node:child_process').ChildProcess|null} */
  let demoProc = null;
  /** @type {Stage} */
  const stage = {
    page,
    point: async (target) => {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) return;
      await page.evaluate(([x, y]) => /** @type {any} */ (window).__cursorTo(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
      await sleep(700);
    },
    click: async (target) => {
      await stage.point(target);
      await page.evaluate(() => /** @type {any} */ (window).__cursorClick());
      await target.click();
      await sleep(350);
    },
    demo: {
      start: (rate) => {
        demoProc = spawn(process.execPath, [join(ROOT, 'bin/livemap.mjs'), 'demo', '--rate', String(rate), '--seed', '3', '--target', 'http://127.0.0.1:4318'], { stdio: 'ignore' });
      },
      stop: () => {
        demoProc?.kill();
        demoProc = null;
      },
    },
  };

  const timeline = [];
  try {
    for (const clip of clips) {
      const startMs = Date.now() - t0;
      const until = Date.now() + clip.ms + GAP_MS;
      console.log(`  scene ${clip.scene.id} at ${(startMs / 1000).toFixed(1)} s`);
      await clip.scene.act(stage);
      const left = until - Date.now();
      if (left > 0) await sleep(left);
      timeline.push({ ...clip, startMs, endMs: Date.now() - t0 });
    }
    await sleep(800);
  } finally {
    stage.demo.stop();
    await context.close();
    await browser.close();
  }
  const video = /** @type {import('@playwright/test').Video} */ (page.video());
  return { video: await video.path(), timeline };
}

/**
 * @param {string} video
 * @param {{scene: Scene, file: string, ms: number, startMs: number, endMs: number}[]} timeline
 */
function mux(video, timeline) {
  const out = join(OUT, 'livemap-demo.mp4');
  const inputs = timeline.flatMap((t) => ['-i', t.file]);
  const delays = timeline.map((t, i) => `[${i + 1}:a]adelay=${t.startMs}:all=1[a${i}]`).join(';');
  const mix = `${timeline.map((_, i) => `[a${i}]`).join('')}amix=inputs=${timeline.length}:normalize=0:dropout_transition=0[voice]`;
  const args = [
    '-y', '-i', video, ...inputs,
    '-filter_complex', `${delays};${mix}`,
    '-map', '0:v', '-map', '[voice]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    out,
  ];
  const res = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (res.status !== 0) fail(`ffmpeg failed:\n${res.stderr.split('\n').slice(-15).join('\n')}`);

  const srt = timeline
    .map((t, i) => `${i + 1}\n${srtTime(t.startMs)} --> ${srtTime(t.startMs + t.ms)}\n${t.scene.text}\n`)
    .join('\n');
  writeFileSync(join(OUT, 'livemap-demo.srt'), srt);
  console.log(`\nWrote ${out} (${(durationMs(out) / 1000).toFixed(1)} s) and livemap-demo.srt`);
}

// ---- Voice ----

/**
 * One narration line from ElevenLabs, cached by voice, model and text.
 * @param {Scene} scene
 * @param {string|undefined} previous
 * @param {string|undefined} next
 */
async function speak(scene, previous, next) {
  const key = createHash('sha256').update(`${VOICE}|${MODEL}|${scene.text}`).digest('hex').slice(0, 16);
  const file = join(AUDIO, `${scene.id}-${key}.mp3`);
  if (existsSync(file)) return file;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: scene.text,
      model_id: MODEL,
      previous_text: previous,
      next_text: next,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) fail(`ElevenLabs answered ${res.status} for "${scene.id}": ${(await res.text()).slice(0, 300)}`);
  writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${file}.part`, file);
  return file;
}

/**
 * Silence as long as the line would take to say (about 2.6 words a second).
 * @param {Scene} scene
 */
async function silentClip(scene) {
  const seconds = (scene.text.split(/\s+/).length / 2.6).toFixed(2);
  const file = join(AUDIO, `${scene.id}-silent-${seconds}.mp3`);
  if (!existsSync(file)) {
    const res = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', seconds, '-q:a', '9', file], { stdio: 'ignore' });
    if (res.status !== 0) fail('ffmpeg could not make placeholder audio');
  }
  return file;
}

// ---- Services ----

function startServices() {
  const livemap = spawn(process.execPath, [join(ROOT, 'bin/livemap.mjs')], { stdio: 'ignore' });
  const examples = spawn(process.execPath, [join(ROOT, 'scripts/examples.mjs'), 'start'], { stdio: 'ignore' });
  return {
    stop: () => {
      for (const p of [examples, livemap]) {
        if (p.exitCode !== null) continue;
        // On Windows a plain kill leaves the examples' children running; end the whole tree.
        if (WIN && p.pid) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
        else p.kill();
      }
    },
  };
}

// ---- Page helpers ----

/** The newest LLM row on screen whose call has a text reply (an a13-style call). */
async function answeredLlmRow(/** @type {import('@playwright/test').Page} */ page) {
  const ids = await page.locator('[data-testid="feed-row"][data-kind="llm"][data-status="ok"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-span-id')));
  for (const id of ids) {
    const span = await (await fetch(`${LIVEMAP}/api/span/${id}`)).json();
    if (span.llm?.response) return id;
  }
  if (!ids[0]) fail('No LLM row on screen to open.');
  return ids[0];
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} selector inside the detail panel
 */
async function scrollPanelTo(page, selector) {
  await page.getByTestId('detail-panel').evaluate((panel, sel) => {
    const target = /** @type {HTMLElement} */ (panel.querySelector(sel));
    if (target) panel.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
  }, selector);
  await sleep(1200);
}

/** A visible cursor for the recording: Playwright's own clicks leave no trace on video. */
function cursorScript() {
  window.addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText =
      'position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(10,10,10,.85);' +
      'border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;' +
      'transform:translate(800px,450px);transition:transform .6s cubic-bezier(.4,0,.2,1)';
    document.body.append(c);
    let x = 800;
    let y = 450;
    /** @type {any} */ (window).__cursorTo = (nx, ny) => {
      x = nx;
      y = ny;
      c.style.transform = `translate(${x}px,${y}px)`;
    };
    /** @type {any} */ (window).__cursorClick = () => {
      const r = document.createElement('div');
      r.style.cssText =
        `position:fixed;left:${x}px;top:${y}px;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;` +
        'border:2px solid rgba(10,10,10,.6);z-index:2147483646;pointer-events:none;transform:scale(.3);opacity:1;' +
        'transition:transform .45s ease-out,opacity .45s ease-out';
      document.body.append(r);
      requestAnimationFrame(() => {
        r.style.transform = 'scale(1)';
        r.style.opacity = '0';
      });
      setTimeout(() => r.remove(), 600);
    };
  });
}

// ---- Utilities ----

function loadEnv() {
  /** @type {Record<string, string>} */
  const out = {};
  const file = join(ROOT, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[2]) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (v) out[k] = v;
  return out;
}

/** @param {string} file */
function durationMs(file) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Math.round(Number(res.stdout.trim()) * 1000);
}

/** @param {number} ms */
function srtTime(ms) {
  const p = (/** @type {number} */ n, w = 2) => String(Math.floor(n)).padStart(w, '0');
  return `${p(ms / 3_600_000)}:${p((ms / 60_000) % 60)}:${p((ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** @param {string} url @param {number} [timeout] */
async function waitFor(url, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  fail(`${url} did not come up`);
}

/** @param {number} port */
function portOpen(port) {
  return new Promise((res) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.on('connect', () => {
      s.destroy();
      res(true);
    });
    s.on('error', () => res(false));
  });
}

/** @param {string} cmd */
function need(cmd) {
  if (spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status !== 0) fail(`${cmd} is not on PATH.`);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string} msg @returns {never} */
function fail(msg) {
  throw new Error(msg);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
