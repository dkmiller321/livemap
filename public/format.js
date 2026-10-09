// Text formats the page shows (E2E_TESTS.md 1.4).

/** @type {Record<string, string>} */
export const KIND_LABELS = { http: 'HTTP', db: 'DB', llm: 'LLM', agent: 'Agent', tool: 'Tool', queue: 'Queue', internal: 'Internal' };

export const KINDS = ['http', 'db', 'llm', 'agent', 'tool', 'queue'];

/**
 * Under 1,000 ms: whole milliseconds. Otherwise seconds with two decimals.
 * @param {number} ms
 */
export function formatDuration(ms) {
  const whole = Math.round(ms);
  if (whole < 1000) return `${whole} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/**
 * Local clock time, HH:MM:SS.
 * @param {number} ms epoch milliseconds
 */
export function formatTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Local date and time with milliseconds, for the detail panel.
 * @param {number} ms
 */
export function formatStart(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(ms)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * `<source> → <target>`, or just the service for a pulse.
 * @param {{source: string, target: string, pulse: boolean}} row
 */
export function routeText(row) {
  return row.pulse || !row.target ? row.source : `${row.source} → ${row.target}`;
}

/** @param {'ok'|'error'} status */
export function statusText(status) {
  return status === 'error' ? 'Error' : 'OK';
}
