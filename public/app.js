// Page entry: the event stream, the read-only stats hook, the empty state and the feed.
import { createFeed } from './feed.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.querySelector(`[data-testid="${id}"]`));

const statusEl = $('connection-status');
const emptyEl = $('empty-state');
const hookupEl = $('hookup-lines');

const counters = {
  connected: false,
  nodes: 0,
  edges: 0,
  rows: 0,
  activeParticles: 0,
  maxActiveParticles: 0,
  particlesSpawned: 0,
  particlesMerged: 0,
  pulsesSpawned: 0,
  fps: 0,
};

Object.defineProperty(window, '__livemap', {
  value: Object.freeze({ stats: () => ({ ...counters, rows: feed.size }) }),
  writable: false,
  configurable: false,
});

const feed = createFeed($('feed'), { onOpen: () => {} });

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
  counters.connected = live;
  statusEl.textContent = live ? 'Live' : 'Reconnecting…';
  statusEl.dataset.live = String(live);
}

/** @param {boolean} empty */
function setEmpty(empty) {
  emptyEl.hidden = !empty;
}

function resetView() {
  feed.clear();
  setEmpty(true);
}

/** @type {Record<string, (data: any) => void>} */
const handlers = {
  snapshot(data) {
    resetView();
    for (const row of data.rows) feed.upsert(row);
    setEmpty(data.spans === 0 && data.rows.length === 0 && data.nodes.length === 0);
    setConnected(true);
  },
  span(row) {
    feed.upsert(row);
    setEmpty(false);
  },
  trace() {
    setEmpty(false);
  },
  clear() {
    resetView();
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

connect();
