// The one masking function. The page runs every piece of displayed content through it,
// so the Hide content switch cannot miss a field. Browser-safe: no Node imports.

export const HIDDEN = '[hidden]';

/** Attribute keys whose whole value is prompt, response or statement text. */
const CONTENT_KEYS = new Set([
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.event.content',
  'db.query.text',
  'db.statement',
  'url.query',
  'input.value',
  'output.value',
  'llm.prompts',
]);

/** Attribute key prefixes for indexed content; `.role` leaves stay visible. */
const CONTENT_PREFIXES = ['gen_ai.prompt.', 'gen_ai.completion.', 'llm.input_messages.', 'llm.output_messages.', 'llm.prompts.'];

/** Attribute keys holding a URL or path whose query string is masked. */
const URL_KEYS = new Set(['url.full', 'http.url', 'http.target']);

/**
 * @typedef {'content'|'statement'|'url'|`attr:${string}`} Field
 * `content` is prompt or response text, `statement` a database statement, `url` a URL or path,
 * and `attr:<key>` an attribute value shown in the attribute list.
 */

/**
 * @param {Field} field
 * @param {any} value
 * @param {boolean} hidden
 * @returns {string} the text to put on screen
 */
export function mask(field, value, hidden) {
  const text = toText(value);
  if (!hidden) return text;
  if (field === 'content' || field === 'statement') return HIDDEN;
  if (field === 'url') return maskQuery(text);
  const key = field.slice(5);
  if (URL_KEYS.has(key)) return maskQuery(text);
  if (CONTENT_KEYS.has(key)) return HIDDEN;
  if (CONTENT_PREFIXES.some((p) => key.startsWith(p)) && !key.endsWith('.role')) return HIDDEN;
  return text;
}

/** @param {string} url */
function maskQuery(url) {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const hash = url.indexOf('#', q);
  return `${url.slice(0, q)}?${HIDDEN}${hash === -1 ? '' : url.slice(hash)}`;
}

/** @param {any} value */
function toText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
