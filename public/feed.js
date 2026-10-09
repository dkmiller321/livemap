// The feed: one row per drawn call or pulse, newest first, at most 500 on the page.
// While the user is scrolled down, new rows wait behind an "N new" pill instead of shifting the list.
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
 * @param {HTMLElement} pill the "N new" button
 * @param {{onOpen: (row: Row, el: HTMLElement) => void}} hooks
 */
export function createFeed(container, pill, hooks) {
  /** @type {Map<string, {row: Row, el: HTMLElement}>} */
  const byId = new Map();
  /** @type {Row[]} rows waiting while the feed is scrolled down, oldest first */
  let waiting = [];
  let selected = '';
  /** @type {(row: Row) => boolean} */
  let visible = () => true;

  const held = () => container.scrollTop > 2;

  container.addEventListener('scroll', () => {
    if (!held() && waiting.length) flush();
  });
  pill.addEventListener('click', () => {
    flush();
    container.scrollTop = 0;
  });

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
    const open = () => hooks.onOpen(/** @type {Row} */ (byId.get(row.spanId)?.row ?? row), el);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
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
    el.hidden = !visible(row);
  }

  /** @param {Row} row */
  function insert(row) {
    const el = render(row);
    if (row.spanId === selected) el.classList.add('selected');
    container.insertBefore(el, container.firstChild);
    byId.set(row.spanId, { row, el });
    while (byId.size > FEED_MAX) {
      const last = /** @type {HTMLElement} */ (container.lastElementChild);
      byId.delete(/** @type {string} */ (last.dataset.spanId));
      last.remove();
    }
  }

  function flush() {
    const rows = waiting;
    waiting = [];
    for (const row of rows) insert(row);
    updatePill();
  }

  function updatePill() {
    pill.hidden = waiting.length === 0;
    pill.textContent = `${waiting.length} new`;
  }

  return {
    /**
     * Adds a row at the top (or behind the pill while scrolled down), or updates it in place.
     * @param {Row} row
     * @returns {boolean} whether the row is new
     */
    upsert(row) {
      const existing = byId.get(row.spanId);
      if (existing) {
        existing.row = row;
        fill(existing.el, row);
        return false;
      }
      const queued = waiting.findIndex((r) => r.spanId === row.spanId);
      if (queued !== -1) {
        waiting[queued] = row;
        return false;
      }
      if (held()) {
        waiting.push(row);
        if (waiting.length > FEED_MAX) waiting.splice(0, waiting.length - FEED_MAX);
        updatePill();
      } else {
        insert(row);
      }
      return true;
    },
    /**
     * Takes a row back (a call Livemap first drew twice).
     * @param {string} spanId
     */
    remove(spanId) {
      byId.get(spanId)?.el.remove();
      byId.delete(spanId);
      waiting = waiting.filter((r) => r.spanId !== spanId);
      updatePill();
    },
    clear() {
      byId.clear();
      waiting = [];
      selected = '';
      container.replaceChildren();
      updatePill();
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
    /** @param {(row: Row) => boolean} fn which rows to show */
    setFilter(fn) {
      visible = fn;
      for (const { row, el } of byId.values()) el.hidden = !visible(row);
    },
    get size() {
      return byId.size;
    },
    /** @param {string} spanId */
    has(spanId) {
      return byId.has(spanId) || waiting.some((r) => r.spanId === spanId);
    },
  };
}
