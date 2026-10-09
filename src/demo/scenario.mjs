// The fixed demo scenario (E2E_TESTS.md 1.5): three traces of a small shop, the same on every run.

/** @typedef {'INTERNAL'|'SERVER'|'CLIENT'|'PRODUCER'|'CONSUMER'} OtelKind */

/**
 * @typedef {object} DemoSpan
 * @property {string} id short id, e.g. a01
 * @property {string} service
 * @property {OtelKind} kind
 * @property {string} name
 * @property {string|null} parent short id
 * @property {number} start ms after the trace starts
 * @property {number} duration ms
 * @property {boolean} error
 * @property {Record<string, any>} attributes
 * @property {{name: string, offset: number, attributes: Record<string, any>}[]} [events]
 */

export const SERVICES = {
  'shop-browser': { 'service.name': 'shop-browser', 'telemetry.sdk.language': 'webjs' },
  'shop-web': { 'service.name': 'shop-web', 'telemetry.sdk.language': 'nodejs' },
  'shop-api': { 'service.name': 'shop-api', 'telemetry.sdk.language': 'nodejs' },
  'shop-worker': { 'service.name': 'shop-worker', 'telemetry.sdk.language': 'nodejs' },
};

const SYSTEM = JSON.stringify([{ type: 'text', content: 'You are a support agent for an online shop.' }]);
const ASK = { role: 'user', parts: [{ type: 'text', content: 'Where is my order 1042?' }] };
const TOOL_CALLS = [
  { type: 'tool_call', id: 'call_1', name: 'lookup_order', arguments: { order_id: 1042 } },
  { type: 'tool_call', id: 'call_2', name: 'check_stock', arguments: { sku: 'SKU-7' } },
];

const LLM_BASE = {
  'gen_ai.operation.name': 'chat',
  'gen_ai.provider.name': 'openai',
  'gen_ai.request.model': 'gpt-4o-mini',
};

/** @param {string} url @param {string} host @param {number} port @param {string} method @param {number} status */
const httpClient = (method, url, host, port, status) => ({
  'http.request.method': method,
  'url.full': url,
  'server.address': host,
  'server.port': port,
  'http.response.status_code': status,
});

/** @param {string} method @param {string} route @param {number} status */
const httpServer = (method, route, status) => ({
  'http.request.method': method,
  'http.route': route,
  'http.response.status_code': status,
});

/** @type {Record<'A'|'B'|'C', DemoSpan[]>} */
export const TRACES = {
  A: [
    { id: 'a01', service: 'shop-browser', kind: 'CLIENT', name: 'POST /api/ask', parent: null, start: 0, duration: 1840, error: false, attributes: httpClient('POST', 'http://localhost:3000/api/ask', 'localhost', 3000, 200) },
    { id: 'a02', service: 'shop-web', kind: 'SERVER', name: 'POST /api/ask', parent: 'a01', start: 20, duration: 1800, error: false, attributes: httpServer('POST', '/api/ask', 200) },
    { id: 'a03', service: 'shop-web', kind: 'CLIENT', name: 'POST /v1/answer', parent: 'a02', start: 40, duration: 1760, error: false, attributes: httpClient('POST', 'http://shop-api:8081/v1/answer', 'shop-api', 8081, 200) },
    { id: 'a04', service: 'shop-api', kind: 'SERVER', name: 'POST /v1/answer', parent: 'a03', start: 50, duration: 1740, error: false, attributes: httpServer('POST', '/v1/answer', 200) },
    { id: 'a05', service: 'shop-api', kind: 'CLIENT', name: 'GET session:42', parent: 'a04', start: 55, duration: 4, error: false, attributes: { 'db.system.name': 'redis', 'db.query.text': 'GET session:42' } },
    { id: 'a06', service: 'shop-api', kind: 'INTERNAL', name: 'invoke_agent support-agent', parent: 'a04', start: 70, duration: 1650, error: false, attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'support-agent', 'gen_ai.provider.name': 'openai' } },
    {
      id: 'a07', service: 'shop-api', kind: 'CLIENT', name: 'chat gpt-4o-mini', parent: 'a06', start: 75, duration: 620, error: false,
      attributes: {
        ...LLM_BASE,
        'gen_ai.usage.input_tokens': 42,
        'gen_ai.usage.output_tokens': 17,
        'gen_ai.response.finish_reasons': ['tool_calls'],
        'gen_ai.system_instructions': SYSTEM,
        'gen_ai.input.messages': JSON.stringify([ASK]),
        'gen_ai.output.messages': JSON.stringify([{ role: 'assistant', parts: TOOL_CALLS, finish_reason: 'tool_calls' }]),
      },
    },
    { id: 'a08', service: 'shop-api', kind: 'CLIENT', name: 'POST', parent: 'a07', start: 80, duration: 610, error: false, attributes: { 'http.request.method': 'POST', 'url.full': 'https://api.openai.com/v1/chat/completions', 'server.address': 'api.openai.com', 'server.port': 443 } },
    { id: 'a09', service: 'shop-api', kind: 'INTERNAL', name: 'execute_tool lookup_order', parent: 'a06', start: 700, duration: 45, error: false, attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'lookup_order', 'gen_ai.tool.call.id': 'call_1' } },
    { id: 'a10', service: 'shop-api', kind: 'CLIENT', name: 'SELECT shop.orders', parent: 'a09', start: 704, duration: 38, error: false, attributes: { 'db.system.name': 'postgresql', 'db.query.text': 'SELECT id, status FROM orders WHERE id = $1' } },
    { id: 'a11', service: 'shop-api', kind: 'INTERNAL', name: 'execute_tool check_stock', parent: 'a06', start: 750, duration: 30, error: false, attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'check_stock', 'gen_ai.tool.call.id': 'call_2' } },
    { id: 'a12', service: 'shop-api', kind: 'CLIENT', name: 'SELECT shop.stock', parent: 'a11', start: 754, duration: 22, error: false, attributes: { 'db.system.name': 'postgresql', 'db.query.text': 'SELECT qty FROM stock WHERE sku = $1' } },
    {
      id: 'a13', service: 'shop-api', kind: 'CLIENT', name: 'chat gpt-4o-mini', parent: 'a06', start: 790, duration: 880, error: false,
      attributes: {
        ...LLM_BASE,
        'gen_ai.usage.input_tokens': 96,
        'gen_ai.usage.output_tokens': 23,
        'gen_ai.response.finish_reasons': ['stop'],
        'gen_ai.system_instructions': SYSTEM,
        'gen_ai.input.messages': JSON.stringify([
          ASK,
          { role: 'assistant', parts: TOOL_CALLS },
          { role: 'tool', parts: [{ type: 'tool_call_response', id: 'call_1', response: '{"status":"shipped"}' }] },
          { role: 'tool', parts: [{ type: 'tool_call_response', id: 'call_2', response: '{"qty":3}' }] },
        ]),
        'gen_ai.output.messages': JSON.stringify([
          { role: 'assistant', parts: [{ type: 'text', content: 'Order 1042 has shipped. 3 units of SKU-7 are in stock.' }], finish_reason: 'stop' },
        ]),
      },
    },
    { id: 'a14', service: 'shop-api', kind: 'INTERNAL', name: 'render answer', parent: 'a04', start: 1725, duration: 12, error: false, attributes: {} },
  ],
  B: [
    { id: 'b01', service: 'shop-browser', kind: 'CLIENT', name: 'POST /api/orders', parent: null, start: 0, duration: 240, error: false, attributes: httpClient('POST', 'http://localhost:3000/api/orders', 'localhost', 3000, 201) },
    { id: 'b02', service: 'shop-web', kind: 'SERVER', name: 'POST /api/orders', parent: 'b01', start: 12, duration: 215, error: false, attributes: httpServer('POST', '/api/orders', 201) },
    { id: 'b03', service: 'shop-web', kind: 'CLIENT', name: 'POST /v1/orders', parent: 'b02', start: 20, duration: 190, error: false, attributes: httpClient('POST', 'http://shop-api:8081/v1/orders', 'shop-api', 8081, 201) },
    { id: 'b04', service: 'shop-api', kind: 'SERVER', name: 'POST /v1/orders', parent: 'b03', start: 26, duration: 180, error: false, attributes: httpServer('POST', '/v1/orders', 201) },
    { id: 'b05', service: 'shop-api', kind: 'CLIENT', name: 'INSERT shop.orders', parent: 'b04', start: 40, duration: 41, error: false, attributes: { 'db.system.name': 'postgresql', 'db.query.text': 'INSERT INTO orders (id, sku, qty) VALUES ($1, $2, $3)' } },
    { id: 'b06', service: 'shop-api', kind: 'PRODUCER', name: 'send orders', parent: 'b04', start: 90, duration: 6, error: false, attributes: { 'messaging.system': 'kafka', 'messaging.destination.name': 'orders', 'messaging.operation.type': 'send' } },
    { id: 'b07', service: 'shop-worker', kind: 'CONSUMER', name: 'process orders', parent: 'b06', start: 110, duration: 320, error: false, attributes: { 'messaging.system': 'kafka', 'messaging.destination.name': 'orders', 'messaging.operation.type': 'process' } },
    { id: 'b08', service: 'shop-worker', kind: 'CLIENT', name: 'UPDATE shop.orders', parent: 'b07', start: 300, duration: 27, error: false, attributes: { 'db.system.name': 'postgresql', 'db.query.text': 'UPDATE orders SET status = $1 WHERE id = $2' } },
  ],
  C: [
    { id: 'c01', service: 'shop-browser', kind: 'CLIENT', name: 'GET /api/recommendations', parent: null, start: 0, duration: 2100, error: true, attributes: httpClient('GET', 'http://localhost:3000/api/recommendations?user=42', 'localhost', 3000, 502) },
    { id: 'c02', service: 'shop-web', kind: 'SERVER', name: 'GET /api/recommendations', parent: 'c01', start: 10, duration: 2080, error: true, attributes: httpServer('GET', '/api/recommendations', 502) },
    { id: 'c03', service: 'shop-web', kind: 'CLIENT', name: 'GET /v1/recommendations', parent: 'c02', start: 20, duration: 2060, error: true, attributes: httpClient('GET', 'http://shop-api:8081/v1/recommendations?user=42', 'shop-api', 8081, 503) },
    {
      id: 'c04', service: 'shop-api', kind: 'SERVER', name: 'GET /v1/recommendations', parent: 'c03', start: 25, duration: 2050, error: true,
      attributes: httpServer('GET', '/v1/recommendations', 503),
      events: [
        {
          name: 'exception',
          offset: 2040,
          attributes: {
            'exception.type': 'UpstreamTimeout',
            'exception.message': 'recommendation model timed out',
            'exception.stacktrace': 'UpstreamTimeout: recommendation model timed out\n    at recommend (/app/src/recommend.js:42:11)',
          },
        },
      ],
    },
    {
      id: 'c05', service: 'shop-api', kind: 'CLIENT', name: 'chat gpt-4o-mini', parent: 'c04', start: 40, duration: 2000, error: true,
      attributes: {
        ...LLM_BASE,
        'error.type': 'timeout',
        'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'Recommend three products for user 42.' }] }]),
      },
    },
  ],
};

export const TRACE_IDS = { A: 'a'.repeat(32), B: 'b'.repeat(32), C: 'c'.repeat(32) };

/**
 * a01 -> a000000000000001
 * @param {string} short
 */
export function longSpanId(short) {
  return `${short[0]}${'0'.repeat(13)}${short.slice(1)}`;
}

const KIND_NUMBER = { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 };

/**
 * One OTLP JSON export request for a trace, anchored so its latest span ends at `endMs`.
 * Spans are grouped by service in the order they are listed.
 * @param {DemoSpan[]} spans
 * @param {{traceId: string, endMs: number, spanId?: (short: string) => string, durationScale?: number}} opts
 */
export function exportRequest(spans, opts) {
  const idOf = opts.spanId ?? longSpanId;
  const scale = opts.durationScale ?? 1;
  const lastEnd = Math.max(...spans.map((s) => (s.start + s.duration) * scale));
  const baseNs = BigInt(Math.round(opts.endMs - lastEnd)) * 1_000_000n;
  const ns = (/** @type {number} */ ms) => (baseNs + BigInt(Math.round(ms * scale * 1000)) * 1000n).toString();
  /** @type {Map<string, any[]>} */
  const byService = new Map();
  for (const s of spans) {
    if (!byService.has(s.service)) byService.set(s.service, []);
    /** @type {any[]} */ (byService.get(s.service)).push({
      traceId: opts.traceId,
      spanId: idOf(s.id),
      ...(s.parent ? { parentSpanId: idOf(s.parent) } : {}),
      name: s.name,
      kind: KIND_NUMBER[s.kind],
      startTimeUnixNano: ns(s.start),
      endTimeUnixNano: ns(s.start + s.duration),
      attributes: toAttributes(s.attributes),
      events: (s.events || []).map((e) => ({ name: e.name, timeUnixNano: ns(e.offset), attributes: toAttributes(e.attributes) })),
      status: s.error ? { code: 2, message: s.events?.[0]?.attributes['exception.message'] ?? '' } : { code: 0 },
    });
  }
  return {
    resourceSpans: [...byService.entries()].map(([service, list]) => ({
      resource: { attributes: toAttributes(SERVICES[/** @type {keyof typeof SERVICES} */ (service)]) },
      scopeSpans: [{ scope: { name: 'livemap-demo' }, spans: list }],
    })),
  };
}

/**
 * @param {Record<string, any>} obj
 * @returns {{key: string, value: any}[]}
 */
export function toAttributes(obj) {
  return Object.entries(obj).map(([key, value]) => ({ key, value: anyValue(value) }));
}

/**
 * @param {any} v
 * @returns {any}
 */
function anyValue(v) {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(anyValue) } };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

/**
 * The three `--once` requests, in order.
 * @param {number} nowMs
 */
export function onceRequests(nowMs) {
  return /** @type {const} */ (['A', 'B', 'C']).map((key) => exportRequest(TRACES[key], { traceId: TRACE_IDS[key], endMs: nowMs }));
}
