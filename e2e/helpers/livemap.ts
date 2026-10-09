// E2E helpers (E2E_TESTS.md 1.3). Every byte reaches Livemap over HTTP through the real receiver.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { request as pwRequest, expect, type Page, type APIResponse, type APIRequestContext } from '@playwright/test';
import { env } from './env';

const require = createRequire(import.meta.url);
// Loaded with require: importing protobufjs through Playwright's ESM loader trips a Node module-status error.
const protobuf: typeof import('protobufjs') = require('protobufjs');

export const BASE_URL = env.BASE_URL;
export const OTLP_URL = env.OTLP_URL;

let shared: Promise<APIRequestContext> | null = null;

/** One request context per worker, reused by every helper. */
export function api(): Promise<APIRequestContext> {
  shared ??= pwRequest.newContext();
  return shared;
}

export async function clear(): Promise<APIResponse> {
  const ctx = await api();
  const res = await ctx.post(`${BASE_URL}/api/clear`);
  await res.body();
  return res;
}

export async function getJson(url: string): Promise<{ status: number; body: any }> {
  const ctx = await api();
  const res = await ctx.get(url);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status(), body };
}

export async function healthz() {
  return getJson(`${BASE_URL}/healthz`);
}

export async function postTraces(
  body: any,
  opts: { contentType?: string; gzip?: boolean; raw?: boolean } = {},
): Promise<APIResponse> {
  const contentType = opts.contentType ?? 'application/json';
  let data: Buffer =
    Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { 'content-type': contentType };
  if (opts.gzip) {
    data = gzipSync(data);
    headers['content-encoding'] = 'gzip';
  }
  const ctx = await api();
  const res = await ctx.post(`${OTLP_URL}/v1/traces`, { data, headers });
  await res.body();
  return res;
}

export async function postLogs(body: any): Promise<APIResponse> {
  const ctx = await api();
  const res = await ctx.post(`${OTLP_URL}/v1/logs`, { data: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  await res.body();
  return res;
}

export async function postMetrics(body: any): Promise<APIResponse> {
  const ctx = await api();
  const res = await ctx.post(`${OTLP_URL}/v1/metrics`, { data: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  await res.body();
  return res;
}

const root = protobuf.Root.fromJSON(require('../../src/otlp/descriptor.json'));
const TraceRequest = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');

/** Encodes an OTLP JSON export request as protobuf with the bundled descriptor. */
export function toProtobuf(json: any): Buffer {
  const hex = (v: string | undefined) => (v ? Buffer.from(v, 'hex') : undefined);
  const value = (v: any): any => {
    if (!v) return v;
    if ('arrayValue' in v) return { arrayValue: { values: v.arrayValue.values.map(value) } };
    if ('kvlistValue' in v) return { kvlistValue: { values: v.kvlistValue.values.map(kv) } };
    return v;
  };
  const kv = (a: any) => ({ key: a.key, value: value(a.value) });
  const converted = {
    resourceSpans: json.resourceSpans.map((rs: any) => ({
      resource: { attributes: rs.resource.attributes.map(kv) },
      scopeSpans: rs.scopeSpans.map((ss: any) => ({
        scope: ss.scope,
        spans: ss.spans.map((s: any) => ({
          ...s,
          traceId: hex(s.traceId),
          spanId: hex(s.spanId),
          parentSpanId: hex(s.parentSpanId),
          attributes: (s.attributes || []).map(kv),
          events: (s.events || []).map((e: any) => ({ ...e, attributes: (e.attributes || []).map(kv) })),
        })),
      })),
    })),
  };
  const msg = TraceRequest.fromObject(converted);
  return Buffer.from(TraceRequest.encode(msg).finish());
}

/** The command that runs Livemap: LIVEMAP_BIN, or `node bin/livemap.mjs`. */
export function livemapCommand(): { command: string; args: string[] } {
  const bin = env.LIVEMAP_BIN;
  if (!bin) return { command: process.execPath, args: [resolve('bin/livemap.mjs')] };
  // An npm .bin shim (livemap / livemap.cmd): run the installed package's own entry with node,
  // so signals reach Livemap itself and not a wrapper shell.
  const shimDir = dirname(bin);
  if (/[\\/]node_modules[\\/]\.bin$/.test(shimDir)) {
    const entry = join(shimDir, '..', 'livemap', 'bin', 'livemap.mjs');
    if (existsSync(entry)) return { command: process.execPath, args: [entry] };
  }
  if (/\.m?js$/.test(bin)) return { command: process.execPath, args: [bin] };
  const parts = bin.match(/"[^"]*"|\S+/g) ?? [];
  const [command, ...args] = parts.map((p) => p.replace(/^"|"$/g, ''));
  return { command, args };
}

export type Spawned = {
  stdout: () => string;
  stderr: () => string;
  exit: Promise<number | null>;
  kill: (signal?: NodeJS.Signals) => void;
  child: ChildProcess;
};

export function spawnLivemap(args: string[], opts: { cwd?: string } = {}): Spawned {
  const { command, args: pre } = livemapCommand();
  const child = spawn(command, [...pre, ...args], { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout!.on('data', (d) => (out += d.toString()));
  child.stderr!.on('data', (d) => (err += d.toString()));
  const exit = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));
  return { stdout: () => out, stderr: () => err, exit, kill: (signal = 'SIGINT') => child.kill(signal), child };
}

export async function playDemoOnce(): Promise<number | null> {
  const p = spawnLivemap(['demo', '--once', '--target', OTLP_URL]);
  const code = await p.exit;
  if (code !== 0) throw new Error(`demo --once exited ${code}: ${p.stderr()}`);
  return code;
}

export function startDemo({ rate, seed }: { rate: number; seed: number }) {
  const p = spawnLivemap(['demo', '--rate', String(rate), '--seed', String(seed), '--target', OTLP_URL]);
  return {
    stop: async () => {
      p.kill('SIGINT');
      await p.exit;
    },
  };
}

export type Stats = {
  connected: boolean;
  nodes: number;
  edges: number;
  rows: number;
  activeParticles: number;
  maxActiveParticles: number;
  particlesSpawned: number;
  particlesMerged: number;
  pulsesSpawned: number;
  fps: number;
};

export async function stats(page: Page): Promise<Stats> {
  return page.evaluate(() => (window as any).__livemap.stats());
}

/** Waits for the page's event stream to be live. */
export async function openLivemap(page: Page, url = `${BASE_URL}/`) {
  await page.goto(url);
  await expect(page.getByTestId('connection-status')).toHaveText('Live', { timeout: 5000 });
}

// ---- Locators used across specs ----

export const row = (page: Page, spanId: string) => page.locator(`[data-testid="feed-row"][data-span-id="${spanId}"]`);
export const rows = (page: Page) => page.getByTestId('feed-row');
export const visibleRows = (page: Page) => page.locator('[data-testid="feed-row"]:visible');
export const node = (page: Page, id: string) => page.locator(`[data-testid="node"][data-node-id="${id}"]`);
export const nodes = (page: Page) => page.getByTestId('node');
export const edge = (page: Page, id: string) => page.locator(`[data-testid="edge"][data-edge-id="${id}"]`);
export const edges = (page: Page) => page.getByTestId('edge');
export const waterfallRow = (page: Page, spanId: string) =>
  page.locator(`[data-testid="waterfall-row"][data-span-id="${spanId}"]`);

/** Demo span id from its short form: a13 -> a000000000000013. */
export const sid = (short: string) => `${short[0]}${'0'.repeat(13)}${short.slice(1)}`;
export const DEMO_TRACE = { A: 'a'.repeat(32), B: 'b'.repeat(32), C: 'c'.repeat(32) };

export async function rowIds(page: Page): Promise<string[]> {
  return page.getByTestId('feed-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-span-id') ?? ''));
}

export async function visibleRowIds(page: Page): Promise<string[]> {
  return visibleRows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-span-id') ?? ''));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
