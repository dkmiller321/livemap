// The span ring buffer with its trace and parent indexes. Holds the newest `max` spans.

/**
 * @template {{spanId: string, traceId: string, parentSpanId: string}} S
 * @typedef {object} Buffer
 * @property {number} max
 * @property {Map<string, S>} spans insertion order is arrival order
 * @property {Map<string, Set<string>>} byTrace traceId -> span ids
 * @property {Map<string, Set<string>>} byParent parentSpanId -> child span ids
 */

/**
 * @template {{spanId: string, traceId: string, parentSpanId: string}} S
 * @param {number} max
 * @returns {Buffer<S>}
 */
export function createBuffer(max) {
  return { max, spans: new Map(), byTrace: new Map(), byParent: new Map() };
}

/**
 * Adds a span, evicting the oldest when full. A span id already held is ignored.
 * Mutates `buf`.
 * @template {{spanId: string, traceId: string, parentSpanId: string}} S
 * @param {Buffer<S>} buf
 * @param {S} span
 * @returns {{added: boolean, evicted: S[]}}
 */
export function addSpan(buf, span) {
  if (buf.spans.has(span.spanId)) return { added: false, evicted: [] };
  buf.spans.set(span.spanId, span);
  index(buf.byTrace, span.traceId, span.spanId);
  if (span.parentSpanId) index(buf.byParent, span.parentSpanId, span.spanId);
  /** @type {S[]} */
  const evicted = [];
  while (buf.spans.size > buf.max) {
    const oldest = /** @type {S} */ (buf.spans.values().next().value);
    removeSpan(buf, oldest);
    evicted.push(oldest);
  }
  return { added: true, evicted };
}

/**
 * @template {{spanId: string, traceId: string, parentSpanId: string}} S
 * @param {Buffer<S>} buf
 * @param {S} span
 */
function removeSpan(buf, span) {
  buf.spans.delete(span.spanId);
  unindex(buf.byTrace, span.traceId, span.spanId);
  if (span.parentSpanId) unindex(buf.byParent, span.parentSpanId, span.spanId);
}

/**
 * @template {{spanId: string, traceId: string, parentSpanId: string}} S
 * @param {Buffer<S>} buf
 * @param {string} traceId
 * @returns {S[]}
 */
export function spansInTrace(buf, traceId) {
  const ids = buf.byTrace.get(traceId);
  if (!ids) return [];
  return [...ids].map((id) => /** @type {S} */ (buf.spans.get(id)));
}

/**
 * @template {{spanId: string, traceId: string, parentSpanId: string}} S
 * @param {Buffer<S>} buf
 * @param {string} spanId
 * @returns {S[]}
 */
export function childrenOf(buf, spanId) {
  const ids = buf.byParent.get(spanId);
  if (!ids) return [];
  return [...ids].map((id) => /** @type {S} */ (buf.spans.get(id)));
}

/**
 * @template {{spanId: string, traceId: string, parentSpanId: string}} S
 * @param {Buffer<S>} buf
 */
export function clearBuffer(buf) {
  buf.spans.clear();
  buf.byTrace.clear();
  buf.byParent.clear();
}

/**
 * @param {Map<string, Set<string>>} map
 * @param {string} key
 * @param {string} id
 */
function index(map, key, id) {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(id);
}

/**
 * @param {Map<string, Set<string>>} map
 * @param {string} key
 * @param {string} id
 */
function unindex(map, key, id) {
  const set = map.get(key);
  if (!set) return;
  set.delete(id);
  if (set.size === 0) map.delete(key);
}
