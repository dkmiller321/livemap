// The OpenTelemetry receiver (OTLP over HTTP, default port 4318).
import { DecodeError, MAX_BODY_BYTES, decodeLogs, decodeTraces, emptyResponse, formatOf, inflate } from '../otlp/decode.mjs';

/**
 * @typedef {object} ReceiverHooks
 * @property {(spans: import('../otlp/decode.mjs').RawSpan[]) => void} onSpans
 * @property {(logs: import('../otlp/decode.mjs').LogEvent[]) => void} onLogs
 */

/**
 * @param {ReceiverHooks} hooks
 * @returns {import('node:http').RequestListener}
 */
export function receiverHandler(hooks) {
  return (req, res) => {
    const path = (req.url || '/').split('?')[0];
    const route = path === '/v1/traces' ? 'traces' : path === '/v1/logs' ? 'logs' : path === '/v1/metrics' ? 'metrics' : null;
    const cors = corsHeaders(req.headers.origin);
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain', ...cors }).end('not found');
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        ...(cors['access-control-allow-origin']
          ? {
              'access-control-allow-methods': 'POST, OPTIONS',
              'access-control-allow-headers': req.headers['access-control-request-headers'] || 'content-type',
              'access-control-max-age': '600',
            }
          : {}),
      }).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST, OPTIONS', ...cors }).end();
      return;
    }
    readBody(req, (body, tooLarge) => {
      /** @type {'json'|'protobuf'} */
      let format = 'json';
      try {
        if (tooLarge) throw new DecodeError(`body over ${MAX_BODY_BYTES} bytes`);
        if (route === 'metrics') {
          format = metricsFormat(req.headers['content-type']);
        } else {
          format = formatOf(req.headers['content-type']);
          const raw = inflate(body, req.headers['content-encoding']);
          if (route === 'traces') hooks.onSpans(decodeTraces(raw, format));
          else hooks.onLogs(decodeLogs(raw, format));
        }
      } catch (err) {
        if (!(err instanceof DecodeError)) throw err;
        process.stderr.write(`livemap: rejected ${path}: ${err.message}\n`);
        res.writeHead(400, { 'content-type': 'text/plain', ...cors }).end(`${err.message}\n`);
        return;
      }
      res
        .writeHead(200, { 'content-type': format === 'json' ? 'application/json' : 'application/x-protobuf', ...cors })
        .end(emptyResponse(format));
    });
  };
}

/**
 * Metrics are accepted and discarded; the reply matches the request's format.
 * @param {string|undefined} contentType
 * @returns {'json'|'protobuf'}
 */
function metricsFormat(contentType) {
  try {
    return formatOf(contentType);
  } catch {
    return 'json';
  }
}

/**
 * Reads the whole body, but stops keeping it past the size limit (the rest is drained).
 * @param {import('node:http').IncomingMessage} req
 * @param {(body: Buffer, tooLarge: boolean) => void} done
 */
function readBody(req, done) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => done(tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge));
}

/**
 * Cross-origin posts are allowed from localhost and 127.0.0.1 pages only (I8).
 * @param {string|undefined} origin
 * @returns {Record<string, string>}
 */
export function corsHeaders(origin) {
  if (!origin) return {};
  let url;
  try {
    url = new URL(origin);
  } catch {
    return {};
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !['localhost', '127.0.0.1'].includes(url.hostname)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' };
}
