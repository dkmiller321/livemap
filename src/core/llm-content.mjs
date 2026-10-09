// The one reader of LLM content. Every supported shape becomes one normalised form.
import { providerOf } from './classify.mjs';

/**
 * @typedef {object} ToolCall
 * @property {string} id
 * @property {string} name
 * @property {string} arguments
 */

/**
 * @typedef {object} Message
 * @property {string} role
 * @property {string} content
 * @property {ToolCall[]} toolCalls
 */

/**
 * @typedef {object} LlmContent
 * @property {string} provider
 * @property {string} model
 * @property {number|null} inputTokens
 * @property {number|null} outputTokens
 * @property {string} finishReason
 * @property {Message[]} messages input messages, system instructions first
 * @property {string|null} response the assistant's text reply
 * @property {ToolCall[]} toolCalls tool calls the model asked for
 * @property {boolean} captured whether any prompt or response content was found
 */

/**
 * @typedef {object} ContentSpan
 * @property {Record<string, any>} attributes
 * @property {{name: string, attributes: Record<string, any>}[]} events
 * @property {{eventName: string, body: any, attributes: Record<string, any>}[]} [logs]
 */

/**
 * Sources, in order: current span attributes, span events and attached log events,
 * legacy indexed attributes, then OpenInference. The first source with input wins the
 * messages; the first source with output wins the response and tool calls.
 * @param {ContentSpan} span
 * @returns {LlmContent}
 */
export function normalizeLlm(span) {
  const a = span.attributes;
  const sources = [fromCurrent(a), fromEvents(span), fromLegacy(a), fromOpenInference(a)];
  const input = sources.find((s) => s.messages.length > 0);
  const output = sources.find((s) => s.response !== null || s.toolCalls.length > 0);
  const messages = input ? input.messages : [];
  const response = output ? output.response : null;
  const toolCalls = output ? output.toolCalls : [];
  const finishReason =
    firstOf(a['gen_ai.response.finish_reasons']) ||
    sources.map((s) => s.finishReason).find(Boolean) ||
    '';
  return {
    provider: providerOf(a),
    model: String(a['gen_ai.request.model'] ?? a['gen_ai.response.model'] ?? a['llm.model_name'] ?? ''),
    inputTokens: num(a['gen_ai.usage.input_tokens'] ?? a['gen_ai.usage.prompt_tokens'] ?? a['llm.token_count.prompt']),
    outputTokens: num(a['gen_ai.usage.output_tokens'] ?? a['gen_ai.usage.completion_tokens'] ?? a['llm.token_count.completion']),
    finishReason,
    messages,
    response,
    toolCalls,
    captured: messages.length > 0 || response !== null || toolCalls.length > 0,
  };
}

/** @typedef {{messages: Message[], response: string|null, toolCalls: ToolCall[], finishReason: string}} Partial */

/** @returns {Partial} */
function empty() {
  return { messages: [], response: null, toolCalls: [], finishReason: '' };
}

/**
 * gen_ai.system_instructions, gen_ai.input.messages, gen_ai.output.messages (JSON strings or arrays).
 * @param {Record<string, any>} a
 * @returns {Partial}
 */
function fromCurrent(a) {
  const out = empty();
  const system = parseJson(a['gen_ai.system_instructions']);
  if (system !== undefined && system !== null) {
    const text = typeof system === 'string' ? system : partsText(Array.isArray(system) ? system : [system]);
    if (text) out.messages.push({ role: 'system', content: text, toolCalls: [] });
  }
  const input = parseJson(a['gen_ai.input.messages']);
  if (Array.isArray(input)) {
    for (const m of input) out.messages.push(partsMessage(m));
  }
  const output = parseJson(a['gen_ai.output.messages']);
  if (Array.isArray(output)) {
    for (const m of output) {
      const msg = partsMessage(m);
      if (msg.content) out.response = out.response === null ? msg.content : `${out.response}\n${msg.content}`;
      out.toolCalls.push(...msg.toolCalls);
      if (!out.finishReason && m && typeof m.finish_reason === 'string') out.finishReason = m.finish_reason;
    }
  }
  return out;
}

/**
 * Span events and attached log events: gen_ai.{system,user,assistant,tool}.message, gen_ai.choice,
 * the older gen_ai.content.prompt / gen_ai.content.completion, and inference detail events
 * that carry the current attributes.
 * @param {ContentSpan} span
 * @returns {Partial}
 */
function fromEvents(span) {
  const out = empty();
  /** @type {{name: string, payload: any}[]} */
  const items = [];
  for (const e of span.events || []) items.push({ name: e.name, payload: eventPayload(e.attributes, undefined) });
  for (const l of span.logs || []) items.push({ name: l.eventName, payload: eventPayload(l.attributes, l.body) });
  for (const { name, payload } of items) {
    if (!name.startsWith('gen_ai.')) continue;
    const role = /^gen_ai\.(system|user|assistant|tool)\.message$/.exec(name)?.[1];
    if (role) {
      out.messages.push({
        role: typeof payload.role === 'string' ? payload.role : role,
        content: contentText(payload.content),
        toolCalls: openAiToolCalls(payload.tool_calls),
      });
    } else if (name === 'gen_ai.choice') {
      const msg = payload.message && typeof payload.message === 'object' ? payload.message : payload;
      const text = contentText(msg.content);
      if (text) out.response = out.response === null ? text : `${out.response}\n${text}`;
      out.toolCalls.push(...openAiToolCalls(msg.tool_calls));
      if (!out.finishReason && typeof payload.finish_reason === 'string') out.finishReason = payload.finish_reason;
    } else if (name === 'gen_ai.content.prompt') {
      const list = parseJson(payload['gen_ai.prompt']);
      if (Array.isArray(list)) for (const m of list) out.messages.push(roleContentMessage(m));
    } else if (name === 'gen_ai.content.completion') {
      const list = parseJson(payload['gen_ai.completion']);
      if (Array.isArray(list)) {
        for (const m of list) {
          const msg = roleContentMessage(m);
          if (msg.content) out.response = out.response === null ? msg.content : `${out.response}\n${msg.content}`;
          out.toolCalls.push(...msg.toolCalls);
        }
      }
    } else if (payload['gen_ai.input.messages'] !== undefined || payload['gen_ai.output.messages'] !== undefined) {
      const inner = fromCurrent(payload);
      out.messages.push(...inner.messages);
      if (inner.response !== null) out.response = inner.response;
      out.toolCalls.push(...inner.toolCalls);
      if (!out.finishReason) out.finishReason = inner.finishReason;
    }
  }
  return out;
}

/**
 * An event's content: the log body when present (object or JSON string), else its attributes,
 * with `gen_ai.event.content` unpacked.
 * @param {Record<string, any>} attributes
 * @param {any} body
 * @returns {Record<string, any>}
 */
function eventPayload(attributes, body) {
  const parsedBody = parseJson(body);
  if (parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)) return { ...attributes, ...parsedBody };
  const inner = parseJson(attributes?.['gen_ai.event.content']);
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return { ...attributes, ...inner };
  return attributes || {};
}

/**
 * gen_ai.prompt.N.* and gen_ai.completion.N.* (OpenLLMetry and older instrumentations).
 * @param {Record<string, any>} a
 * @returns {Partial}
 */
function fromLegacy(a) {
  const out = empty();
  for (const m of indexed(a, 'gen_ai.prompt.')) out.messages.push(flatMessage(m, 'tool_calls'));
  for (const m of indexed(a, 'gen_ai.completion.')) {
    const msg = flatMessage(m, 'tool_calls');
    if (msg.content) out.response = out.response === null ? msg.content : `${out.response}\n${msg.content}`;
    out.toolCalls.push(...msg.toolCalls);
    if (!out.finishReason && typeof m.finish_reason === 'string') out.finishReason = m.finish_reason;
  }
  return out;
}

/**
 * llm.input_messages.N.message.* and llm.output_messages.N.message.* (OpenInference).
 * @param {Record<string, any>} a
 * @returns {Partial}
 */
function fromOpenInference(a) {
  const out = empty();
  for (const m of indexed(a, 'llm.input_messages.')) out.messages.push(oiMessage(m));
  for (const m of indexed(a, 'llm.output_messages.')) {
    const msg = oiMessage(m);
    if (msg.content) out.response = out.response === null ? msg.content : `${out.response}\n${msg.content}`;
    out.toolCalls.push(...msg.toolCalls);
  }
  return out;
}

/**
 * Groups `prefix.N.rest` keys into nested objects, ordered by N.
 * @param {Record<string, any>} a
 * @param {string} prefix
 * @returns {Record<string, any>[]}
 */
function indexed(a, prefix) {
  /** @type {Map<number, Record<string, any>>} */
  const groups = new Map();
  for (const [key, value] of Object.entries(a)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const m = /^(\d+)\.(.+)$/.exec(rest);
    if (!m) continue;
    const i = Number(m[1]);
    if (!groups.has(i)) groups.set(i, {});
    setPath(/** @type {Record<string, any>} */ (groups.get(i)), m[2].split('.'), value);
  }
  return [...groups.entries()].sort((x, y) => x[0] - y[0]).map(([, v]) => v);
}

/**
 * @param {Record<string, any>} obj
 * @param {string[]} path
 * @param {any} value
 */
function setPath(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
}

/**
 * @param {Record<string, any>} m
 * @param {string} toolKey
 * @returns {Message}
 */
function flatMessage(m, toolKey) {
  const calls = m[toolKey] && typeof m[toolKey] === 'object' ? Object.keys(m[toolKey]).sort((x, y) => Number(x) - Number(y)).map((k) => m[toolKey][k]) : [];
  return {
    role: String(m.role ?? 'user'),
    content: contentText(m.content),
    toolCalls: calls.map((c) => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? c.function?.name ?? ''),
      arguments: stringify(c.arguments ?? c.function?.arguments ?? ''),
    })),
  };
}

/**
 * @param {Record<string, any>} m
 * @returns {Message}
 */
function oiMessage(m) {
  const msg = m.message || {};
  const calls = msg.tool_calls && typeof msg.tool_calls === 'object'
    ? Object.keys(msg.tool_calls).sort((x, y) => Number(x) - Number(y)).map((k) => msg.tool_calls[k].tool_call || {})
    : [];
  return {
    role: String(msg.role ?? 'user'),
    content: contentText(msg.content),
    toolCalls: calls.map((c) => ({
      id: String(c.id ?? ''),
      name: String(c.function?.name ?? ''),
      arguments: stringify(c.function?.arguments ?? ''),
    })),
  };
}

/**
 * A GenAI parts message: {role, parts: [{type: 'text'|'tool_call'|'tool_call_response', ...}]}.
 * @param {any} m
 * @returns {Message}
 */
function partsMessage(m) {
  if (!m || typeof m !== 'object') return { role: 'user', content: contentText(m), toolCalls: [] };
  const parts = Array.isArray(m.parts) ? m.parts : [];
  /** @type {ToolCall[]} */
  const toolCalls = [];
  for (const p of parts) {
    if (p && p.type === 'tool_call') {
      toolCalls.push({ id: String(p.id ?? ''), name: String(p.name ?? ''), arguments: stringify(p.arguments ?? '') });
    }
  }
  const content = parts.length ? partsText(parts) : contentText(m.content);
  return { role: String(m.role ?? 'user'), content, toolCalls };
}

/**
 * @param {any[]} parts
 * @returns {string}
 */
function partsText(parts) {
  /** @type {string[]} */
  const texts = [];
  for (const p of parts) {
    if (typeof p === 'string') texts.push(p);
    else if (!p || typeof p !== 'object') continue;
    else if (p.type === 'text' || (p.type === undefined && p.content !== undefined)) texts.push(contentText(p.content));
    else if (p.type === 'tool_call_response') texts.push(stringify(p.response ?? p.result ?? ''));
  }
  return texts.filter(Boolean).join('\n');
}

/**
 * @param {any} m
 * @returns {Message}
 */
function roleContentMessage(m) {
  if (!m || typeof m !== 'object') return { role: 'user', content: contentText(m), toolCalls: [] };
  return { role: String(m.role ?? 'user'), content: contentText(m.content), toolCalls: openAiToolCalls(m.tool_calls) };
}

/**
 * OpenAI-style tool calls: [{id, type, function: {name, arguments}}].
 * @param {any} list
 * @returns {ToolCall[]}
 */
function openAiToolCalls(list) {
  const parsed = parseJson(list);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((c) => ({
    id: String(c?.id ?? ''),
    name: String(c?.function?.name ?? c?.name ?? ''),
    arguments: stringify(c?.function?.arguments ?? c?.arguments ?? ''),
  }));
}

/**
 * Text from a content value: a string, a list of parts, or anything else as JSON.
 * @param {any} v
 * @returns {string}
 */
function contentText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return partsText(v.map((p) => (p && typeof p === 'object' && p.text !== undefined ? { type: 'text', content: p.text } : p)));
  return stringify(v);
}

/** @param {any} v */
function stringify(v) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** @param {any} v */
function parseJson(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/** @param {any} v */
function firstOf(v) {
  const p = parseJson(v);
  if (Array.isArray(p)) return p.length ? String(p[0]) : '';
  return typeof p === 'string' ? p : '';
}

/** @param {any} v */
function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
