// The feed: one row per drawn call or pulse, newest first, at most 500 on the page.
import { KIND_LABELS, formatDuration, formatTime, routeText, statusText } from './format.js';

export const FEED_MAX = 500;

/**
 * @typedef {object} Row
 * @property {string} spanId
 * @property {string} traceId
 * @property {string} name
 * @property {string} kind
 * @property {'ok'|'error'} status
 * @property {number} durationMs
 * @property {number} startMs
 * @property {string} source
 * @property {string} target
 * @property {boolean} pulse
 */

/**
 * @param {HTMLElement} container the scrollable feed
 * @param {{onOpen: (row: Row, el: HTMLElement) => void}} hooks
 */
export function createFeed(container, hooks) {
  /** @type {Map<string, {row: Row, el: HTMLElement}>} */
  const byId = new Map();
  let selected = '';

  /** @param {Row} row */
  function render(row) {
    const el = document.createElement('div');
    el.className = 'row';
    el.dataset.testid = 'feed-row';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML =
      '<div class="row-top"><span class="kind" data-testid="row-kind"></span><span class="row-name" data-testid="row-name"></span>' +
      '<span class="row-duration" data-testid="row-duration"></span></div>' +
      '<div class="row-bottom"><span class="row-route" data-testid="row-route"></span>' +
      '<span class="row-status" data-testid="row-status"></span><span class="row-time" data-testid="row-time"></span></div>';
    fill(el, row);
    el.addEventListener('click', () => hooks.onOpen(/** @type {Row} */ (byId.get(row.spanId)?.row ?? row), el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        hooks.onOpen(/** @type {Row} */ (byId.get(row.spanId)?.row ?? row), el);
      }
    });
    return el;
  }

  /**
   * @param {HTMLElement} el
   * @param {Row} row
   */
  function fill(el, row) {
    el.dataset.spanId = row.spanId;
    el.dataset.kind = row.kind;
    el.dataset.status = row.status;
    const q = (/** @type {string} */ id) => /** @type {HTMLElement} */ (el.querySelector(`[data-testid="${id}"]`));
    const kind = q('row-kind');
    kind.textContent = KIND_LABELS[row.kind] ?? row.kind;
    kind.dataset.kind = row.kind;
    q('row-name').textContent = row.name;
    q('row-name').title = row.name;
    q('row-route').textContent = routeText(row);
    q('row-duration').textContent = formatDuration(row.durationMs);
    q('row-status').textContent = statusText(row.status);
    q('row-time').textContent = formatTime(row.startMs);
    el.setAttribute('aria-label', `${KIND_LABELS[row.kind] ?? row.kind} ${row.name}, ${routeText(row)}, ${formatDuration(row.durationMs)}, ${statusText(row.status)}`);
  }

  return {
    /**
     * Adds a row at the top, or updates it in place if it is already shown.
     * @param {Row} row
     */
    upsert(row) {
      const existing = byId.get(row.spanId);
      if (existing) {
        existing.row = row;
        fill(existing.el, row);
        return;
      }
      const el = render(row);
      container.insertBefore(el, container.firstChild);
      byId.set(row.spanId, { row, el });
      while (byId.size > FEED_MAX) {
        const last = /** @type {HTMLElement} */ (container.lastElementChild);
        byId.delete(/** @type {string} */ (last.dataset.spanId));
        last.remove();
      }
    },
    clear() {
      byId.clear();
      selected = '';
      container.replaceChildren();
    },
    /**
     * Marks the row whose detail is open.
     * @param {string} spanId '' for none
     */
    select(spanId) {
      byId.get(selected)?.el.classList.remove('selected');
      selected = spanId;
      byId.get(spanId)?.el.classList.add('selected');
    },
    get size() {
      return byId.size;
    },
    /** @param {string} spanId */
    element(spanId) {
      return byId.get(spanId)?.el ?? null;
    },
  };
}
