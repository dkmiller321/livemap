// Span builder and the fixtures of E2E_TESTS.md 1.6. Plain JS so scripts/fixtures-dump.mjs can use it too.

const KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 };

/**
 * @typedef {object} SpanSpec
 * @property {string} [id] 16 hex digits
 * @property {string} [traceId] 32 hex digits
 * @property {string} [parent] parent span id
 * @property {string} [service]
 * @property {string} [sdkLanguage]
 * @property {string} [name]
 * @property {'INTERNAL'|'SERVER'|'CLIENT'|'PRODUCER'|'CONSUMER'} [kind] defaults to INTERNAL, as in OpenTelemetry
 * @property {number} [durationMs]
 * @property {'ok'|'error'} [status]
 * @property {Record<string, any>} [attributes]
 * @property {number} [endMs] defaults to now
 */

/**
 * @typedef {object} BuiltSpan
 * @property {string} service
 * @property {string} sdkLanguage
 * @property {any} otlp the OTLP JSON span
 */

/** @param {number} n */
export function randomHex(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/**
 * One OTLP JSON span with defaults: INTERNAL, random ids, start = now - duration, status OK.
 * @param {SpanSpec} [o]
 * @returns {BuiltSpan}
 */
export function span(o = {}) {
  const durationMs = o.durationMs ?? 10;
  const endMs = o.endMs ?? Date.now();
  const endNs = BigInt(Math.round(endMs)) * 1_000_000n;
  const startNs = endNs - BigInt(Math.round(durationMs * 1000)) * 1000n;
  return {
    service: o.service ?? 'test-svc',
    sdkLanguage: o.sdkLanguage ?? 'nodejs',
    otlp: {
      traceId: o.traceId ?? randomHex(32),
      spanId: o.id ?? randomHex(16),
      ...(o.parent ? { parentSpanId: o.parent } : {}),
      name: o.name ?? 'span',
      kind: KIND[o.kind ?? 'INTERNAL'],
      startTimeUnixNano: startNs.toString(),
      endTimeUnixNano: endNs.toString(),
      attributes: toAttributes(o.attributes ?? {}),
      status: o.status === 'error' ? { code: 2 } : { code: 0 },
    },
  };
}

/**
 * Groups spans by service into one OTLP JSON export request, keeping their order.
 * @param {...BuiltSpan} spans
 */
export function request(...spans) {
  /** @type {Map<string, {sdkLanguage: string, spans: any[]}>} */
  const groups = new Map();
  for (const s of spans) {
    const g = groups.get(s.service) ?? { sdkLanguage: s.sdkLanguage, spans: [] };
    g.spans.push(s.otlp);
    groups.set(s.service, g);
  }
  return {
    resourceSpans: [...groups.entries()].map(([service, g]) => ({
      resource: { attributes: toAttributes({ 'service.name': service, 'telemetry.sdk.language': g.sdkLanguage }) },
      scopeSpans: [{ scope: { name: 'e2e' }, spans: g.spans }],
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
export function anyValue(v) {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(anyValue) } };
  if (v && typeof v === 'object') return { kvlistValue: { values: toAttributes(v) } };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

/** @param {string} prefix @param {number} index @param {number} [width] */
export function indexedId(prefix, index, width = 14) {
  return prefix + index.toString(16).padStart(width, '0');
}

/** @param {string} prefix */
const trace = (prefix) => prefix.padEnd(32, '0');

/**
 * @param {string} host
 * @param {number} port
 * @param {string} method
 * @param {string} path
 */
const clientAttrs = (method, host, port, path) => ({
  'http.request.method': method,
  'server.address': host,
  'server.port': port,
  'url.full': `${port === 443 ? 'https' : 'http'}://${host}${port === 443 || port === 80 ? '' : `:${port}`}${path}`,
});

// ---- Fixtures ----

/** @param {Partial<SpanSpec>} [o] */
export function entryHttpSpan(o = {}) {
  return span({
    id: 'f100000000000001',
    traceId: trace('f1'),
    service: 'solo-api',
    name: 'GET /ping',
    kind: 'SERVER',
    durationMs: 25,
    attributes: { 'http.request.method': 'GET', 'http.route': '/ping', 'http.response.status_code': 200 },
    ...o,
  });
}

/** @param {Partial<SpanSpec>} [o] */
export function entryHttp(o = {}) {
  return request(entryHttpSpan(o));
}

export function pairClient() {
  return span({ id: 'd100000000000001', traceId: trace('d1'), service: 'front', name: 'GET /items', kind: 'CLIENT', durationMs: 40, attributes: clientAttrs('GET', 'back.internal', 8080, '/items') });
}

export function pairServer() {
  return span({
    id: 'd100000000000002',
    traceId: trace('d1'),
    parent: 'd100000000000001',
    service: 'back',
    name: 'GET /items',
    kind: 'SERVER',
    durationMs: 30,
    attributes: { 'http.request.method': 'GET', 'http.route': '/items', 'http.response.status_code': 200 },
  });
}

export function pair() {
  return request(pairClient(), pairServer());
}

export function pairAgain() {
  return request(span({ id: 'd100000000000003', traceId: trace('d1a'), service: 'front', name: 'GET /items', kind: 'CLIENT', durationMs: 35, attributes: clientAttrs('GET', 'back.internal', 8080, '/items') }));
}

export function orphan() {
  return request(
    span({
      id: 'd200000000000001',
      traceId: trace('d2'),
      parent: 'd2000000000000ff',
      service: 'orphan',
      name: 'GET /orphan',
      kind: 'SERVER',
      durationMs: 20,
      attributes: { 'http.request.method': 'GET', 'http.route': '/orphan', 'http.response.status_code': 200 },
    }),
  );
}

export function stripe() {
  return request(span({ id: 'd300000000000001', traceId: trace('d3'), service: 'front', name: 'POST', kind: 'CLIENT', durationMs: 120, attributes: clientAttrs('POST', 'api.stripe.com', 443, '/v1/charges') }));
}

export function lateClient() {
  return request(span({ id: 'd400000000000001', traceId: trace('d4'), service: 'front', name: 'GET', kind: 'CLIENT', durationMs: 50, attributes: clientAttrs('GET', 'orders.internal', 9000, '/orders') }));
}

export function lateServer() {
  return request(
    span({
      id: 'd400000000000002',
      traceId: trace('d4'),
      parent: 'd400000000000001',
      service: 'orders-svc',
      name: 'GET /orders',
      kind: 'SERVER',
      durationMs: 40,
      attributes: { 'http.request.method': 'GET', 'http.route': '/orders', 'http.response.status_code': 200 },
    }),
  );
}

export function kinds() {
  const t = trace('e1');
  const root = 'e100000000000001';
  /** @param {string} suffix @param {Partial<SpanSpec>} o */
  const child = (suffix, o) => span({ id: `e1000000000000${suffix}`, traceId: t, parent: root, service: 'kinds-svc', durationMs: 5, ...o });
  return request(
    span({ id: root, traceId: t, service: 'kinds-svc', name: 'GET /kinds', kind: 'SERVER', durationMs: 50, attributes: { 'http.request.method': 'GET', 'http.route': '/kinds' } }),
    child('02', { name: 'SELECT kinds', kind: 'CLIENT', attributes: { 'db.system.name': 'postgresql', 'db.query.text': 'SELECT 1' } }),
    child('03', { name: 'chat claude', kind: 'CLIENT', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': 'anthropic' } }),
    child('04', { name: 'invoke_agent helper', attributes: { 'gen_ai.operation.name': 'invoke_agent' } }),
    child('05', { name: 'execute_tool search', attributes: { 'gen_ai.operation.name': 'execute_tool' } }),
    child('06', { name: 'publish jobs', kind: 'PRODUCER', attributes: { 'messaging.system': 'rabbitmq' } }),
    child('07', { name: 'compute', kind: 'INTERNAL', attributes: {} }),
    child('08', { name: 'legacy chat', kind: 'CLIENT', attributes: { 'gen_ai.system': 'openai' } }),
    child('09', { name: 'legacy query', kind: 'CLIENT', attributes: { 'db.system': 'mysql' } }),
    child('0a', { name: 'legacy GET', kind: 'CLIENT', attributes: { 'http.method': 'GET', 'net.peer.name': 'legacy.example.com', 'net.peer.port': 443 } }),
  );
}

/**
 * `n` INTERNAL spans in requests of at most 1,000.
 * @param {number} n
 */
export function flood(n) {
  const requests = [];
  for (let start = 0; start < n; start += 1000) {
    const list = [];
    for (let i = start; i < Math.min(n, start + 1000); i++) {
      list.push(span({ id: indexedId('e2', i), traceId: indexedId('e2', i, 30), service: 'flood', name: `flood ${i}`, durationMs: 1 }));
    }
    requests.push(request(...list));
  }
  return requests;
}

/** @param {number} i */
export function floodId(i) {
  return indexedId('e2', i);
}

/**
 * `n` copies of entry-http in one request, named GET /ping/<index>.
 * @param {number} n
 * @param {number} [first] first index, for fresh ids
 */
export function entries(n, first = 0) {
  const list = [];
  for (let i = first; i < first + n; i++) {
    list.push(entryHttpSpan({ id: indexedId('e3', i), traceId: indexedId('e3', i, 30), name: `GET /ping/${i}` }));
  }
  return request(...list);
}

/** @param {number} i */
export function entryId(i) {
  return indexedId('e3', i);
}

export function llmBare() {
  return request(
    span({
      id: 'd500000000000001',
      traceId: trace('d5'),
      service: 'logs-svc',
      name: 'chat gpt-x',
      kind: 'CLIENT',
      durationMs: 300,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'openai',
        'gen_ai.request.model': 'gpt-x',
        'gen_ai.usage.input_tokens': 7,
        'gen_ai.usage.output_tokens': 3,
      },
    }),
  );
}

/**
 * The three log records of E2E-27, for the span of `llm-bare`.
 */
export function llmBareLogs() {
  const now = BigInt(Date.now()) * 1_000_000n;
  /** @param {string} eventName @param {any} body */
  const record = (eventName, body) => ({
    timeUnixNano: now.toString(),
    traceId: trace('d5'),
    spanId: 'd500000000000001',
    eventName,
    body: anyValue(body),
    attributes: [],
  });
  return {
    resourceLogs: [
      {
        resource: { attributes: toAttributes({ 'service.name': 'logs-svc' }) },
        scopeLogs: [
          {
            scope: { name: 'e2e' },
            logRecords: [
              record('gen_ai.user.message', { content: 'ping from logs' }),
              record('gen_ai.choice', { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'pong from logs' } }),
              record('app.started', 'ignored'),
            ],
          },
        ],
      },
    ],
  };
}

export function otherConventions() {
  return request(
    span({
      id: 'd600000000000001',
      traceId: trace('d6'),
      service: 'oi-svc',
      name: 'ChatCompletion',
      durationMs: 200,
      attributes: {
        'openinference.span.kind': 'LLM',
        'llm.provider': 'anthropic',
        'llm.model_name': 'claude-x',
        'llm.token_count.prompt': 11,
        'llm.token_count.completion': 4,
        'llm.input_messages.0.message.role': 'user',
        'llm.input_messages.0.message.content': 'hi from openinference',
        'llm.output_messages.0.message.role': 'assistant',
        'llm.output_messages.0.message.content': 'hello back',
      },
    }),
    span({
      id: 'd600000000000002',
      traceId: trace('d6b'),
      service: 'ollm-svc',
      name: 'openai.chat',
      kind: 'CLIENT',
      durationMs: 150,
      attributes: {
        'gen_ai.system': 'openai',
        'llm.request.type': 'chat',
        'gen_ai.request.model': 'gpt-y',
        'gen_ai.usage.prompt_tokens': 9,
        'gen_ai.usage.completion_tokens': 2,
        'gen_ai.prompt.0.role': 'user',
        'gen_ai.prompt.0.content': 'hi from openllmetry',
        'gen_ai.completion.0.role': 'assistant',
        'gen_ai.completion.0.content': 'hey there',
      },
    }),
  );
}

export function lateTraceFirst() {
  const t = trace('d7');
  return request(
    span({ id: 'd700000000000001', traceId: t, service: 'late-svc', name: 'GET /late', kind: 'SERVER', durationMs: 80, attributes: { 'http.request.method': 'GET', 'http.route': '/late' } }),
    span({ id: 'd700000000000002', traceId: t, parent: 'd700000000000001', service: 'late-svc', name: 'SELECT late', kind: 'CLIENT', durationMs: 10, attributes: { 'db.system.name': 'sqlite', 'db.query.text': 'SELECT 1' } }),
  );
}

export function lateTraceSecond() {
  return request(
    span({ id: 'd700000000000003', traceId: trace('d7'), parent: 'd700000000000001', service: 'late-svc', name: 'SELECT later', kind: 'CLIENT', durationMs: 12, attributes: { 'db.system.name': 'sqlite', 'db.query.text': 'SELECT 2' } }),
  );
}
