// Page entry: the event stream, the read-only stats hook and the empty state.

const statusEl = /** @type {HTMLElement} */ (document.querySelector('[data-testid="connection-status"]'));
const emptyEl = /** @type {HTMLElement} */ (document.querySelector('[data-testid="empty-state"]'));
const hookupEl = /** @type {HTMLElement} */ (document.querySelector('[data-testid="hookup-lines"]'));

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
  value: Object.freeze({ stats: () => ({ ...counters }) }),
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
  counters.connected = live;
  statusEl.textContent = live ? 'Live' : 'Reconnecting…';
  statusEl.dataset.live = String(live);
}

function connect() {
  const source = new EventSource('/events');
  source.addEventListener('snapshot', () => setConnected(true));
  source.addEventListener('error', () => {
    setConnected(false);
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      setTimeout(connect, 1000);
    }
  });
}

emptyEl.hidden = false;
connect();
