// Kind rules and node naming. Pure functions over span attributes.

/** @typedef {'agent'|'tool'|'llm'|'db'|'queue'|'http'|'internal'} SpanKind */
/** @typedef {'browser'|'outside'|'service'|'db'|'queue'|'llm'|'external'} NodeKind */

const AGENT_OPS = new Set(['invoke_agent', 'create_agent']);

/**
 * PRD section 6: the first matching rule decides. Rows 3a–3c are the P1 conventions (K8):
 * OpenInference (`openinference.span.kind`) and OpenLLMetry (`traceloop.span.kind`, `llm.request.type`).
 * @param {Record<string, any>} a span attributes
 * @returns {SpanKind}
 */
export function classifyKind(a) {
  const op = a['gen_ai.operation.name'];
  if (op !== undefined && op !== null && op !== '') {
    if (AGENT_OPS.has(op)) return 'agent';
    if (op === 'execute_tool') return 'tool';
    return 'llm';
  }
  if (has(a, 'gen_ai.provider.name') || has(a, 'gen_ai.system')) return 'llm';
  const oi = String(a['openinference.span.kind'] ?? '').toUpperCase();
  if (oi === 'AGENT') return 'agent';
  if (oi === 'TOOL') return 'tool';
  if (oi === 'LLM' || oi === 'EMBEDDING') return 'llm';
  const tl = String(a['traceloop.span.kind'] ?? '').toLowerCase();
  if (tl === 'agent') return 'agent';
  if (tl === 'tool') return 'tool';
  if (has(a, 'llm.request.type')) return 'llm';
  if (has(a, 'db.system.name') || has(a, 'db.system')) return 'db';
  if (has(a, 'messaging.system')) return 'queue';
  if (has(a, 'http.request.method') || has(a, 'http.method') || has(a, 'rpc.system')) return 'http';
  return 'internal';
}

/**
 * @param {Record<string, any>} a
 * @param {string} key
 */
function has(a, key) {
  const v = a[key];
  return v !== undefined && v !== null && v !== '';
}

/** @param {Record<string, any>} a */
export function providerOf(a) {
  for (const key of ['gen_ai.provider.name', 'gen_ai.system', 'llm.provider', 'llm.system']) {
    if (has(a, key)) return String(a[key]);
  }
  return '';
}

/** @param {Record<string, any>} a */
export function dbSystemOf(a) {
  return String(a['db.system.name'] ?? a['db.system'] ?? '');
}

/** @param {Record<string, any>} a */
export function queueSystemOf(a) {
  return String(a['messaging.system'] ?? '');
}

/** @param {string} sdkLanguage */
export function serviceNodeKind(sdkLanguage) {
  return sdkLanguage === 'webjs' ? 'browser' : 'service';
}

/**
 * The host and port a client span called.
 * @param {Record<string, any>} a
 * @returns {{host: string, port: string}}
 */
export function addressOf(a) {
  let host = String(a['server.address'] ?? a['net.peer.name'] ?? a['net.peer.ip'] ?? '');
  let port = String(a['server.port'] ?? a['net.peer.port'] ?? '');
  const rawUrl = a['url.full'] ?? a['http.url'];
  if ((!host || !port) && typeof rawUrl === 'string') {
    try {
      const u = new URL(rawUrl);
      if (!host) host = u.hostname.replace(/^\[|\]$/g, '');
      if (!port) port = u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '');
    } catch {
      // Not a URL: fall through to http.host.
    }
  }
  if (!host && typeof a['http.host'] === 'string') {
    const [h, p] = a['http.host'].split(':');
    host = h;
    if (!port) port = p || '';
  }
  return { host: host.toLowerCase(), port };
}

/**
 * @param {{host: string, port: string}} addr
 * @returns {string} '' when the span names no host
 */
export function addressKey(addr) {
  return addr.host ? `${addr.host}:${addr.port}` : '';
}

/**
 * External node id: the host, with :port unless the port is 80 or 443.
 * @param {{host: string, port: string}} addr
 */
export function externalNodeId(addr) {
  if (!addr.host) return 'unknown';
  return addr.port && addr.port !== '80' && addr.port !== '443' ? `${addr.host}:${addr.port}` : addr.host;
}

/**
 * Column for a node kind (M2).
 * @param {NodeKind} kind
 */
export function columnOf(kind) {
  if (kind === 'browser' || kind === 'outside') return 0;
  if (kind === 'service') return 1;
  return 2;
}
