// Page entry: the event stream, the read-only stats hook, and wiring between map, particles and feed.
import { createFeed } from './feed.js';
import { createMap } from './map.js';
import { createParticles } from './particles.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.querySelector(`[data-testid="${id}"]`));

const statusEl = $('connection-status');
const emptyEl = $('empty-state');
const hookupEl = $('hookup-lines');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let connected = false;

const map = createMap($('map'), $('legend'), {
  onNode: () => {},
  onEdge: () => {},
});
const particles = createParticles(map.canvas, { area: () => map.area });
const feed = createFeed($('feed'), { onOpen: () => {} });

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

/** @param {boolean} live */
function setConnected(live) {
  connected = live;
  statusEl.textContent = live ? 'Live' : 'Reconnecting…';
  statusEl.dataset.live = String(live);
}

/** @param {boolean} empty */
function setEmpty(empty) {
  emptyEl.hidden = !empty;
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
  span(row) {
    const isNew = !feed.element(row.spanId);
    feed.upsert(row);
    setEmpty(false);
    if (isNew) animate(row);
  },
  counts(c) {
    map.setCounts(c, Date.now());
  },
  trace() {
    setEmpty(false);
  },
  clear() {
    resetView();
    particles.reset();
  },
};

function connect() {
  const source = new EventSource('/events');
  for (const [type, handle] of Object.entries(handlers)) {
    source.addEventListener(type, (e) => handle(JSON.parse(/** @type {MessageEvent} */ (e).data)));
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
connect();
