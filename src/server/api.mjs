// The page server and JSON API (default port 4400).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PUBLIC = new URL('../../public/', import.meta.url);
const MASK = new URL('../core/mask.mjs', import.meta.url);

/** Files the page may load. Nothing else on disk is reachable. */
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/map.js', ['map.js', 'text/javascript; charset=utf-8']],
  ['/particles.js', ['particles.js', 'text/javascript; charset=utf-8']],
  ['/feed.js', ['feed.js', 'text/javascript; charset=utf-8']],
  ['/detail.js', ['detail.js', 'text/javascript; charset=utf-8']],
  ['/format.js', ['format.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

/**
 * @typedef {object} ApiDeps
 * @property {number} port
 * @property {number} otlpPort
 * @property {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} openStream
 * @property {(spanId: string) => any} span
 * @property {(traceId: string) => any[]} trace
 * @property {() => void} clear
 * @property {() => number} spanCount
 */

/**
 * @param {ApiDeps} deps
 * @returns {import('node:http').RequestListener}
 */
export function apiHandler(deps) {
  const allowedHosts = new Set([`127.0.0.1:${deps.port}`, `localhost:${deps.port}`]);
  return (req, res) => {
    // Refuse other Host names so a web page cannot reach the API through DNS rebinding.
    if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden host\n');
      return;
    }
    const path = (req.url || '/').split('?')[0];
    const method = req.method || 'GET';
    if (method === 'GET' && path === '/healthz') return json(res, 200, { status: 'ok', spans: deps.spanCount() });
    if (method === 'GET' && path === '/events') return deps.openStream(req, res);
    if (method === 'POST' && path === '/api/clear') {
      req.resume();
      deps.clear();
      return json(res, 200, { cleared: true });
    }
    let m = /^\/api\/span\/([0-9a-f]{16})$/.exec(path);
    if (method === 'GET' && m) {
      const span = deps.span(m[1]);
      return span ? json(res, 200, span) : json(res, 404, { error: 'span not in buffer' });
    }
    m = /^\/api\/trace\/([0-9a-f]{32})$/.exec(path);
    if (method === 'GET' && m) return json(res, 200, { traceId: m[1], spans: deps.trace(m[1]) });
    if (method === 'GET' && path === '/config.json') return json(res, 200, { otlpPort: deps.otlpPort });
    if (method === 'GET' && path === '/core/mask.mjs') return file(res, fileURLToPath(MASK), 'text/javascript; charset=utf-8');
    const entry = method === 'GET' ? STATIC.get(path) : undefined;
    if (entry) return file(res, fileURLToPath(new URL(entry[0], PUBLIC)), entry[1]);
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
  };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} path
 * @param {string} type
 */
function file(res, path, type) {
  readFile(path).then((body) => {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }).end(body);
  });
}
