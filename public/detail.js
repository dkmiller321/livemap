// The detail panel: span summary, LLM / HTTP / database / error detail, the trace waterfall and
// every attribute. Data is fetched on open; everything shown passes through `mask`.
import { mask } from './core/mask.mjs';
import { formatDuration, formatStart, statusText } from './format.js';

/**
 * @typedef {object} DetailHooks
 * @property {(edgeId: string) => void} highlight
 * @property {(spanId: string) => void} selected the span now shown, '' when closed
 * @property {() => boolean} hidden whether Hide content is on
 */

/**
 * @param {HTMLElement} panel
 * @param {DetailHooks} hooks
 */
export function createDetail(panel, hooks) {
  const q = (/** @type {string} */ id) => /** @type {HTMLElement} */ (panel.querySelector(`[data-testid="${id}"]`));
  const section = (/** @type {string} */ name) => /** @type {HTMLElement} */ (panel.querySelector(`[data-section="${name}"]`));
  /** @type {any} */
  let span = null;
  /** @type {any[]} */
  let trace = [];
  let traceId = '';
  let token = 0;
  /** @type {HTMLElement|null} */
  let returnFocus = null;

  q('detail-close').addEventListener('click', () => close());

  /** @param {import('./core/mask.mjs').Field} field @param {any} value */
  const show = (field, value) => mask(field, value, hooks.hidden());

  /**
   * @param {string} url
   * @returns {Promise<any>}
   */
  async function getJson(url) {
    const res = await fetch(url);
    return res.ok ? res.json() : null;
  }

  /**
   * @param {string} spanId
   * @param {{refreshTrace?: boolean}} [opts]
   */
  async function load(spanId, opts = {}) {
    const mine = ++token;
    const s = await getJson(`/api/span/${spanId}`);
    if (mine !== token) return;
    if (!s) {
      renderMissing(spanId);
      return;
    }
    span = s;
    if (opts.refreshTrace || s.traceId !== traceId || !trace.some((t) => t.spanId === spanId)) {
      const t = await getJson(`/api/trace/${s.traceId}`);
      if (mine !== token) return;
      trace = t ? t.spans : [];
      traceId = s.traceId;
    }
    render();
  }

  /** @param {string} spanId */
  function renderMissing(spanId) {
    span = null;
    q('detail-name').textContent = 'No longer in the buffer';
    q('detail-kind').textContent = '';
    q('detail-service').textContent = '';
    q('detail-start').textContent = '';
    q('detail-duration').textContent = '';
    q('detail-status').textContent = '';
    for (const name of ['llm', 'http', 'db', 'error']) section(name).hidden = true;
    q('detail-attributes').replaceChildren();
    q('waterfall').replaceChildren();
    hooks.selected(spanId);
    hooks.highlight('');
  }

  function render() {
    if (!span) return;
    const s = span;
    q('detail-name').textContent = s.name;
    q('detail-kind').textContent = s.kind;
    q('detail-kind').dataset.kind = s.kind;
    q('detail-service').textContent = s.service;
    q('detail-start').textContent = formatStart(s.startMs);
    q('detail-duration').textContent = formatDuration(s.durationMs);
    q('detail-status').textContent = statusText(s.status);
    q('detail-status').dataset.status = s.status;
    renderLlm(s.llm);
    renderHttp(s.http);
    renderDb(s.db);
    renderError(s.error);
    renderWaterfall();
    renderAttributes(s.attributes);
    hooks.highlight(s.edgeId);
    hooks.selected(s.spanId);
  }

  /** @param {any} llm */
  function renderLlm(llm) {
    const box = section('llm');
    box.hidden = !llm;
    if (!llm) return;
    q('llm-provider').textContent = llm.provider || '—';
    q('llm-model').textContent = llm.model || '—';
    q('llm-input-tokens').textContent = llm.inputTokens === null ? '—' : String(llm.inputTokens);
    q('llm-output-tokens').textContent = llm.outputTokens === null ? '—' : String(llm.outputTokens);
    q('llm-finish-reason').textContent = llm.finishReason || '—';
    const messages = q('llm-messages');
    messages.replaceChildren(
      ...llm.messages.map((/** @type {any} */ m) => {
        const el = document.createElement('div');
        el.className = 'message';
        el.dataset.testid = 'llm-message';
        el.dataset.role = m.role;
        const text = m.content || m.toolCalls.map((/** @type {any} */ c) => `${c.name}(${c.arguments})`).join('\n');
        el.textContent = show('content', text);
        return el;
      }),
    );
    messages.hidden = llm.messages.length === 0;
    const response = q('llm-response');
    response.hidden = llm.response === null;
    response.textContent = llm.response === null ? '' : show('content', llm.response);
    const calls = q('llm-tool-calls');
    calls.replaceChildren(
      ...llm.toolCalls.map((/** @type {any} */ c) => {
        const el = document.createElement('div');
        el.className = 'tool-call';
        el.dataset.testid = 'llm-tool-call';
        el.dataset.toolName = c.name;
        const name = document.createElement('span');
        name.className = 'tool-call-name';
        name.textContent = c.name;
        const args = document.createElement('code');
        args.textContent = show('content', c.arguments);
        el.append(name, args);
        return el;
      }),
    );
    calls.hidden = llm.toolCalls.length === 0;
    q('llm-no-content').hidden = llm.captured;
  }

  /** @param {any} http */
  function renderHttp(http) {
    const box = section('http');
    box.hidden = !http;
    if (!http) return;
    q('http-method').textContent = http.method || '—';
    q('http-target').textContent = show('url', http.target) || '—';
    q('http-status').textContent = http.status || '—';
  }

  /** @param {any} db */
  function renderDb(db) {
    const box = section('db');
    box.hidden = !db;
    if (!db) return;
    q('db-system').textContent = db.system || '—';
    q('db-statement').textContent = show('statement', db.statement);
  }

  /** @param {any} error */
  function renderError(error) {
    const box = section('error');
    box.hidden = !error;
    if (!error) return;
    q('error-type').textContent = error.type || '—';
    q('error-message').textContent = error.message || '—';
    q('error-stack').textContent = error.stack;
    q('error-stack').hidden = !error.stack;
  }

  function renderWaterfall() {
    const box = q('waterfall');
    if (trace.length === 0) {
      box.replaceChildren();
      return;
    }
    const start = Math.min(...trace.map((t) => t.startMs));
    const end = Math.max(...trace.map((t) => t.startMs + t.durationMs));
    const total = Math.max(1, end - start);
    box.replaceChildren(
      ...trace.map((t) => {
        const el = document.createElement('div');
        el.className = 'wf-row';
        el.dataset.testid = 'waterfall-row';
        el.dataset.spanId = t.spanId;
        el.dataset.depth = String(t.depth);
        el.dataset.service = t.service;
        el.dataset.kind = t.kind;
        el.dataset.status = t.status;
        el.dataset.selected = String(span && t.spanId === span.spanId);
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `${t.name} in ${t.service}, ${formatDuration(t.durationMs)}`);
        const label = document.createElement('div');
        label.className = 'wf-label';
        label.style.paddingLeft = `${t.depth * 12}px`;
        const name = document.createElement('span');
        name.className = 'wf-name';
        name.textContent = t.name;
        const svc = document.createElement('span');
        svc.className = 'wf-service';
        svc.textContent = t.service;
        label.append(name, svc);
        const lane = document.createElement('div');
        lane.className = 'wf-lane';
        const bar = document.createElement('div');
        bar.className = 'wf-bar';
        bar.style.left = `${((t.startMs - start) / total) * 100}%`;
        bar.style.width = `max(2px, ${(t.durationMs / total) * 100}%)`;
        const dur = document.createElement('span');
        dur.className = 'wf-duration';
        dur.textContent = formatDuration(t.durationMs);
        lane.append(bar);
        el.append(label, lane, dur);
        const pick = () => load(t.spanId);
        el.addEventListener('click', pick);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
        return el;
      }),
    );
  }

  /** @param {Record<string, any>} attributes */
  function renderAttributes(attributes) {
    const keys = Object.keys(attributes).sort();
    q('detail-attributes').replaceChildren(
      ...keys.map((key) => {
        const el = document.createElement('div');
        el.className = 'attr';
        el.dataset.testid = 'attr-row';
        el.dataset.key = key;
        el.title = key;
        el.textContent = show(`attr:${key}`, attributes[key]);
        return el;
      }),
    );
  }

  /** @param {boolean} [restoreFocus] */
  function close(restoreFocus = true) {
    token++;
    panel.hidden = true;
    span = null;
    trace = [];
    traceId = '';
    q('waterfall').replaceChildren();
    q('detail-attributes').replaceChildren();
    hooks.highlight('');
    hooks.selected('');
    if (restoreFocus && returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  return {
    /**
     * @param {string} spanId
     * @param {HTMLElement|null} opener focus returns here on close
     */
    open(spanId, opener) {
      returnFocus = opener;
      panel.hidden = false;
      load(spanId);
    },
    close,
    get isOpen() {
      return !panel.hidden;
    },
    /** Re-renders with the current Hide content setting. */
    rerender() {
      render();
    },
    /**
     * A trace received new spans or content: refresh the open view (D7).
     * @param {string} changedTraceId
     */
    traceChanged(changedTraceId) {
      if (panel.hidden || !span || changedTraceId !== traceId) return;
      load(span.spanId, { refreshTrace: true });
    },
  };
}
