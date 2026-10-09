// Page entry: the event stream, the read-only stats hook, and wiring between map, particles,
// feed, detail panel and the controls.
import { createDetail } from './detail.js';
import { createFeed } from './feed.js';
import { createMap } from './map.js';
import { createParticles } from './particles.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.querySelector(`[data-testid="${id}"]`));

const statusEl = $('connection-status');
const emptyEl = $('empty-state');
const hookupEl = $('hookup-lines');
const pauseButton = /** @type {HTMLButtonElement} */ ($('pause-button'));
const hideToggle = /** @type {HTMLInputElement} */ ($('hide-content-toggle'));
const kindFilter = /** @type {HTMLSelectElement} */ ($('filter-kind'));
const errorsFilter = /** @type {HTMLInputElement} */ ($('filter-errors'));
const textFilter = /** @type {HTMLInputElement} */ ($('filter-text'));
const chip = $('filter-chip');
const chipRow = /** @type {HTMLElement} */ (chip.parentElement);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const HIDE_KEY = 'livemap.hideContent';

let connected = false;
let paused = false;
/** @type {{type: string, data: any}[]} events held while paused */
let held = [];
/** @type {{node: string} | {edge: string, source: string, target: string} | null} */
let scope = null;

const map = createMap($('map'), $('legend'), {
  onNode: (id) => setScope({ node: id }),
  onEdge: (id) => {
    const [source, target] = id.split('>');
    setScope({ edge: id, source, target });
  },
});
const particles = createParticles(map.canvas, { area: () => map.area });
const feed = createFeed($('feed'), $('new-rows-pill'), { onOpen: (row, el) => detail.open(row.spanId, el) });
const detail = createDetail($('detail-panel'), {
  highlight: (edgeId) => map.highlight(edgeId),
  selected: (spanId) => feed.select(spanId),
  hidden: () => hideToggle.checked,
});

Object.defineProperty(window, '__livemap', {
  value: Object.freeze({
    stats: () => ({
      connected,
      nodes: map.size.nodes,
      edges: map.size.edges,
      rows: feed.size,
      ...particles.stats(),
    }),
  }),
  writable: false,
  configurable: false,
});

// ---- Controls ----

hideToggle.checked = localStorage.getItem(HIDE_KEY) === 'true';
hideToggle.addEventListener('change', () => {
  localStorage.setItem(HIDE_KEY, String(hideToggle.checked));
  detail.rerender();
});

pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  pauseButton.setAttribute('aria-pressed', String(paused));
  particles.freeze(paused);
  if (!paused) {
    const backlog = held;
    held = [];
    for (const e of backlog) handlers[e.type](e.data);
  }
});

$('clear-button').addEventListener('click', () => {
  fetch('/api/clear', { method: 'POST' });
});

/** @param {typeof scope} next */
function setScope(next) {
  scope = next;
  chipRow.hidden = !scope;
  chip.textContent = !scope ? '' : 'node' in scope ? scope.node : `${scope.source} → ${scope.target}`;
  applyFilter();
}

$('filter-chip-clear').addEventListener('click', () => setScope(null));
kindFilter.addEventListener('change', applyFilter);
errorsFilter.addEventListener('change', applyFilter);
textFilter.addEventListener('input', applyFilter);

function applyFilter() {
  const kind = kindFilter.value;
  const errorsOnly = errorsFilter.checked;
  const text = textFilter.value.trim().toLowerCase();
  const s = scope;
  feed.setFilter((row) => {
    if (kind !== 'all' && row.kind !== kind) return false;
    if (errorsOnly && row.status !== 'error') return false;
    if (text && !row.name.toLowerCase().includes(text)) return false;
    if (s && 'node' in s && row.source !== s.node && row.target !== s.node) return false;
    if (s && 'edge' in s && (row.pulse || `${row.source}>${row.target}` !== s.edge)) return false;
    return true;
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && detail.isOpen) {
    e.preventDefault();
    detail.close();
  }
});

// ---- Empty state ----

/** @param {number} otlpPort */
function hookupLines(otlpPort) {
  return [
    `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${otlpPort}`,
    'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
    'OTEL_TRACES_EXPORTER=otlp',
    'OTEL_BSP_SCHEDULE_DELAY=200',
  ].join('\n');
}

hookupEl.textContent = hookupLines(4318);
fetch('/config.json')
  .then((r) => r.json())
  .then((cfg) => {
    hookupEl.textContent = hookupLines(cfg.otlpPort);
  });

/** @param {boolean} empty */
function setEmpty(empty) {
  emptyEl.hidden = !empty;
}

// ---- Event stream ----

/** @param {boolean} live */
function setConnected(live) {
  connected = live;
  statusEl.textContent = live ? 'Live' : 'Reconnecting…';
  statusEl.dataset.live = String(live);
}

function resetView() {
  feed.clear();
  map.reset();
  setEmpty(true);
}

/**
 * Animates one newly drawn call: a particle along its edge, or a pulse on its node.
 * @param {import('./feed.js').Row} row
 */
function animate(row) {
  const now = Date.now();
  map.touch(row.source, now);
  if (row.pulse) {
    const c = map.nodeCenter(row.source);
    if (c) particles.pulse({ ...c, kind: row.kind, error: row.status === 'error', animate: !reducedMotion.matches });
    if (row.status === 'error') map.flashError('', row.source);
    return;
  }
  map.touch(row.target, now);
  const edgeId = `${row.source}>${row.target}`;
  if (row.status === 'error') map.flashError(edgeId, row.target);
  if (reducedMotion.matches) {
    map.flashEdge(edgeId);
    return;
  }
  const ends = map.edgeEnds(edgeId);
  if (ends) particles.spawn({ edgeId, ...ends, durationMs: row.durationMs, kind: row.kind, error: row.status === 'error' });
}

/** @type {Record<string, (data: any) => void>} */
const handlers = {
  snapshot(data) {
    held = [];
    resetView();
    for (const n of data.nodes) map.addNode(n);
    for (const e of data.edges) map.addEdge(e);
    for (const row of data.rows) feed.upsert(row);
    map.setCounts(data.counts, Date.now());
    setEmpty(data.spans === 0 && data.rows.length === 0 && data.nodes.length === 0);
    setConnected(true);
  },
  node(n) {
    map.addNode(n);
    setEmpty(false);
  },
  edge(e) {
    map.addEdge(e);
  },
  'node-removed'(d) {
    map.removeNode(d.id);
  },
  'edge-removed'(d) {
    map.removeEdge(d.id);
  },
  'span-removed'(d) {
    feed.remove(d.spanId);
  },
  span(row) {
    setEmpty(false);
    if (feed.upsert(row)) animate(row);
  },
  counts(c) {
    map.setCounts(c, Date.now());
  },
  trace(d) {
    setEmpty(false);
    detail.traceChanged(d.traceId);
  },
  clear() {
    held = [];
    detail.close(false);
    resetView();
    particles.reset();
  },
};

/**
 * While paused, everything but `snapshot` and `clear` waits; Resume replays it in order.
 * @param {string} type
 * @param {any} data
 */
function dispatch(type, data) {
  if (paused && type !== 'snapshot' && type !== 'clear') {
    held.push({ type, data });
    return;
  }
  handlers[type](data);
}

function connect() {
  const source = new EventSource('/events');
  for (const type of Object.keys(handlers)) {
    source.addEventListener(type, (e) => dispatch(type, JSON.parse(/** @type {MessageEvent} */ (e).data)));
  }
  source.addEventListener('error', () => {
    setConnected(false);
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      setTimeout(connect, 1000);
    }
  });
}

window.addEventListener('resize', () => map.layout());
setInterval(() => map.markIdle(Date.now()), 1000);
applyFilter();
connect();
