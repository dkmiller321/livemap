// Turns OTLP export requests (JSON or protobuf, optionally gzip) into plain span and log records.
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import protobuf from 'protobufjs';

const require = createRequire(import.meta.url);
const root = protobuf.Root.fromJSON(require('./descriptor.json'));
const TraceRequest = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
const LogsRequest = root.lookupType('opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest');

export const MAX_BODY_BYTES = 10 * 1024 * 1024;

const SPAN_KINDS = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];

/**
 * @typedef {object} SpanEvent
 * @property {string} name
 * @property {number} timeMs
 * @property {Record<string, any>} attributes
 */

/**
 * @typedef {object} RawSpan
 * @property {string} traceId
 * @property {string} spanId
 * @property {string} parentSpanId
 * @property {string} service
 * @property {string} sdkLanguage
 * @property {string} name
 * @property {string} otelKind
 * @property {number} startMs
 * @property {number} endMs
 * @property {number} durationMs
 * @property {'ok'|'error'} status
 * @property {string} statusMessage
 * @property {Record<string, any>} attributes
 * @property {Record<string, any>} resource
 * @property {SpanEvent[]} events
 */

/**
 * @typedef {object} LogEvent
 * @property {string} traceId
 * @property {string} spanId
 * @property {string} eventName
 * @property {number} timeMs
 * @property {any} body
 * @property {Record<string, any>} attributes
 */

export class DecodeError extends Error {}

/**
 * @param {Buffer} body
 * @param {string|undefined} contentEncoding
 * @returns {Buffer}
 */
export function inflate(body, contentEncoding) {
  const enc = (contentEncoding || 'identity').toLowerCase().trim();
  if (enc === 'identity' || enc === '') return body;
  if (enc !== 'gzip') throw new DecodeError(`unsupported content-encoding ${enc}`);
  try {
    return gunzipSync(body, { maxOutputLength: MAX_BODY_BYTES });
  } catch (err) {
    throw new DecodeError(`bad gzip body: ${/** @type {Error} */ (err).message}`);
  }
}

/**
 * @param {string|undefined} contentType
 * @returns {'json'|'protobuf'}
 */
export function formatOf(contentType) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json') return 'json';
  if (type === 'application/x-protobuf' || type === 'application/protobuf') return 'protobuf';
  throw new DecodeError(`unsupported content-type ${type || '(none)'}`);
}

/**
 * @param {Buffer} body already inflated
 * @param {'json'|'protobuf'} format
 * @returns {RawSpan[]}
 */
export function decodeTraces(body, format) {
  const req = format === 'json' ? parseJson(body) : decodeProto(TraceRequest, body);
  const resourceSpans = listField(req, 'resourceSpans');
  /** @type {RawSpan[]} */
  const spans = [];
  for (const rs of resourceSpans) {
    const resource = attrsToObject(listField(rs.resource || {}, 'attributes'));
    const service = typeof resource['service.name'] === 'string' && resource['service.name'] ? resource['service.name'] : 'unknown_service';
    const sdkLanguage = String(resource['telemetry.sdk.language'] || '');
    for (const ss of listField(rs, 'scopeSpans')) {
      for (const s of listField(ss, 'spans')) spans.push(toSpan(s, service, sdkLanguage, resource));
    }
  }
  return spans;
}

/**
 * @param {Buffer} body already inflated
 * @param {'json'|'protobuf'} format
 * @returns {LogEvent[]}
 */
export function decodeLogs(body, format) {
  const req = format === 'json' ? parseJson(body) : decodeProto(LogsRequest, body);
  /** @type {LogEvent[]} */
  const out = [];
  for (const rl of listField(req, 'resourceLogs')) {
    for (const sl of listField(rl, 'scopeLogs')) {
      for (const r of listField(sl, 'logRecords')) {
        const attributes = attrsToObject(listField(r, 'attributes'));
        out.push({
          traceId: idToHex(r.traceId, 32, true),
          spanId: idToHex(r.spanId, 16, true),
          eventName: String(r.eventName || attributes['event.name'] || ''),
          timeMs: nanosToMs(r.timeUnixNano || r.observedTimeUnixNano || 0),
          body: r.body === undefined || r.body === null ? null : anyValue(r.body),
          attributes,
        });
      }
    }
  }
  return out;
}

/** @param {Buffer} body */
function parseJson(body) {
  let value;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch (err) {
    throw new DecodeError(`bad JSON: ${/** @type {Error} */ (err).message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DecodeError('body is not a JSON object');
  return value;
}

/**
 * @param {protobuf.Type} type
 * @param {Buffer} body
 */
function decodeProto(type, body) {
  let msg;
  try {
    msg = type.decode(body);
  } catch (err) {
    throw new DecodeError(`bad protobuf: ${/** @type {Error} */ (err).message}`);
  }
  return type.toObject(msg, { longs: String, enums: Number, bytes: Buffer, defaults: false, arrays: true });
}

/**
 * @param {any} obj
 * @param {string} key
 * @returns {any[]}
 */
function listField(obj, key) {
  const v = obj?.[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new DecodeError(`${key} is not a list`);
  return v;
}

/**
 * @param {any} s
 * @param {string} service
 * @param {string} sdkLanguage
 * @param {Record<string, any>} resource
 * @returns {RawSpan}
 */
function toSpan(s, service, sdkLanguage, resource) {
  if (!s || typeof s !== 'object') throw new DecodeError('span is not an object');
  const traceId = idToHex(s.traceId, 32, false);
  const spanId = idToHex(s.spanId, 16, false);
  const parentSpanId = idToHex(s.parentSpanId, 16, true);
  const startNs = toBigInt(s.startTimeUnixNano);
  const endNs = toBigInt(s.endTimeUnixNano);
  const startMs = Number(startNs / 1000n) / 1000;
  const endMs = endNs >= startNs ? Number(endNs / 1000n) / 1000 : startMs;
  const status = s.status || {};
  const code = status.code;
  const isError = code === 2 || code === 'STATUS_CODE_ERROR';
  return {
    traceId,
    spanId,
    parentSpanId,
    service,
    sdkLanguage,
    name: typeof s.name === 'string' ? s.name : '',
    otelKind: kindName(s.kind),
    startMs,
    endMs,
    durationMs: endMs - startMs,
    status: isError ? 'error' : 'ok',
    statusMessage: typeof status.message === 'string' ? status.message : '',
    attributes: attrsToObject(listField(s, 'attributes')),
    resource,
    events: listField(s, 'events').map((e) => ({
      name: String(e?.name || ''),
      timeMs: nanosToMs(e?.timeUnixNano || 0),
      attributes: attrsToObject(listField(e, 'attributes')),
    })),
  };
}

/** @param {any} kind */
function kindName(kind) {
  if (typeof kind === 'number') return SPAN_KINDS[kind] || 'UNSPECIFIED';
  if (typeof kind === 'string') {
    const name = kind.replace(/^SPAN_KIND_/, '');
    return SPAN_KINDS.includes(name) ? name : 'UNSPECIFIED';
  }
  return 'UNSPECIFIED';
}

/**
 * Ids are hex in OTLP JSON and bytes in protobuf.
 * @param {any} v
 * @param {number} hexLength
 * @param {boolean} optional
 */
function idToHex(v, hexLength, optional) {
  if (v === undefined || v === null || v === '' || (Buffer.isBuffer(v) && v.length === 0)) {
    if (optional) return '';
    throw new DecodeError('span is missing an id');
  }
  const hex = Buffer.isBuffer(v) || v instanceof Uint8Array ? Buffer.from(v).toString('hex') : String(v).toLowerCase();
  if (hex.length !== hexLength || !/^[0-9a-f]+$/.test(hex)) {
    if (optional && /^0*$/.test(hex)) return '';
    throw new DecodeError(`bad id ${hex.slice(0, 40)}`);
  }
  if (/^0+$/.test(hex)) {
    if (optional) return '';
    throw new DecodeError('all-zero id');
  }
  return hex;
}

/** @param {any} v */
function toBigInt(v) {
  if (v === undefined || v === null || v === '') return 0n;
  try {
    return BigInt(typeof v === 'number' ? Math.trunc(v) : String(v));
  } catch {
    throw new DecodeError(`bad timestamp ${String(v).slice(0, 40)}`);
  }
}

/** @param {any} v */
function nanosToMs(v) {
  return Number(toBigInt(v) / 1000n) / 1000;
}

/**
 * @param {any[]} list
 * @returns {Record<string, any>}
 */
function attrsToObject(list) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const kv of list) {
    if (!kv || typeof kv.key !== 'string') throw new DecodeError('attribute without a key');
    out[kv.key] = kv.value === undefined || kv.value === null ? null : anyValue(kv.value);
  }
  return out;
}

/**
 * @param {any} v an OTLP AnyValue
 * @returns {any}
 */
export function anyValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if ('stringValue' in v) return String(v.stringValue);
  if ('boolValue' in v) return Boolean(v.boolValue);
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('arrayValue' in v) return listField(v.arrayValue || {}, 'values').map(anyValue);
  if ('kvlistValue' in v) return attrsToObject(listField(v.kvlistValue || {}, 'values'));
  if ('bytesValue' in v) {
    const b = v.bytesValue;
    return Buffer.isBuffer(b) || b instanceof Uint8Array ? Buffer.from(b).toString('base64') : String(b);
  }
  return null;
}

/**
 * The empty export response, in the request's format.
 * @param {'json'|'protobuf'} format
 */
export function emptyResponse(format) {
  return format === 'json' ? Buffer.from('{}') : Buffer.alloc(0);
}
