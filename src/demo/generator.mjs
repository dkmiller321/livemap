// Plays the demo app through the real receiver: once (fixed), or for ever (randomised, seeded).
import { request } from 'node:http';
import { TRACES, TRACE_IDS, exportRequest } from './scenario.mjs';

/**
 * Posts one OTLP JSON export request.
 * @param {string} target receiver base URL, loopback only
 * @param {any} body
 * @returns {Promise<number>} the HTTP status
 */
export function postTraces(target, body) {
  const data = Buffer.from(JSON.stringify(body));
  const url = new URL('/v1/traces', target);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode || 0));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

/**
 * `--once`: trace A, then B, then C. Resolves after the third 200.
 * @param {string} target
 */
export async function playOnce(target) {
  for (const key of /** @type {const} */ (['A', 'B', 'C'])) {
    const status = await postTraces(target, exportRequest(TRACES[key], { traceId: TRACE_IDS[key], endMs: Date.now() }));
    if (status !== 200) throw new Error(`the receiver at ${target} answered ${status}`);
  }
}

/**
 * Seeded pseudo-random numbers in [0, 1).
 * @param {number} seed
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One randomised variation: new ids, scaled durations; about one trace in ten is the failing one.
 * @param {() => number} rand
 * @param {number} endMs
 */
export function randomTrace(rand, endMs) {
  const hex = (/** @type {number} */ n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
  const key = rand() < 0.1 ? 'C' : rand() < 0.5 ? 'A' : 'B';
  const traceId = hex(32);
  /** @type {Map<string, string>} */
  const ids = new Map();
  const spanId = (/** @type {string} */ short) => {
    if (!ids.has(short)) ids.set(short, hex(16));
    return /** @type {string} */ (ids.get(short));
  };
  const durationScale = 0.6 + rand() * 0.8;
  return { key, spans: TRACES[key].length, body: exportRequest(TRACES[key], { traceId, endMs, spanId, durationScale }) };
}

/**
 * Plays random traces at about `rate` spans per second until stopped.
 * @param {{target: string, rate: number, seed: number, onError: (err: Error) => void}} opts
 * @returns {{stop: () => void}}
 */
export function playForever(opts) {
  const rand = mulberry32(opts.seed);
  let stopped = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  let due = Date.now();
  const tick = () => {
    if (stopped) return;
    const trace = randomTrace(rand, Date.now());
    postTraces(opts.target, trace.body).then(
      (status) => {
        if (status !== 200 && !stopped) opts.onError(new Error(`the receiver at ${opts.target} answered ${status}`));
      },
      (err) => {
        if (!stopped) opts.onError(err);
      },
    );
    due += (trace.spans / opts.rate) * 1000;
    timer = setTimeout(tick, Math.max(0, due - Date.now()));
  };
  tick();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
