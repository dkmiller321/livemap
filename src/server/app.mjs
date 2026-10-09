// Starts both listeners on 127.0.0.1 and wires them to the in-memory state.
import { createServer } from 'node:http';
import {
  clearState,
  createState,
  currentCounts,
  expire,
  ingestLogs,
  ingestSpans,
  nextDeadline,
  snapshot,
  spanCount,
  spanView,
  traceView,
} from '../core/engine.mjs';
import { apiHandler } from './api.mjs';
import { receiverHandler } from './receiver.mjs';
import { broadcast, closeHub, connect, createHub } from './sse.mjs';

const HOST = '127.0.0.1';
const COUNTS_EVERY_MS = 1000;
const COUNTS_DEBOUNCE_MS = 50;

export class PortInUseError extends Error {
  /**
   * @param {number} port
   * @param {string} flag
   */
  constructor(port, flag) {
    super(`Port ${port} is already in use. Choose another with ${flag}.`);
    this.port = port;
    this.flag = flag;
  }
}

/**
 * @param {{port: number, otlpPort: number, maxSpans: number}} opts
 * @returns {Promise<{close: () => Promise<void>}>}
 */
export async function startLivemap(opts) {
  const state = createState({ maxSpans: opts.maxSpans });
  const hub = createHub();
  /** @type {ReturnType<typeof setTimeout>|null} */
  let pairTimer = null;
  let pairTimerAt = Infinity;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let countsTimer = null;

  /** @param {import('../core/engine.mjs').Event[]} events */
  const publish = (events) => {
    broadcast(hub, events);
    if (events.some((e) => e.type === 'span' || e.type === 'span-removed' || e.type === 'node-removed')) scheduleCounts();
    schedulePairing();
  };

  const scheduleCounts = () => {
    if (countsTimer) return;
    countsTimer = setTimeout(() => {
      countsTimer = null;
      broadcast(hub, [{ type: 'counts', data: currentCounts(state, Date.now()) }]);
    }, COUNTS_DEBOUNCE_MS);
  };

  const schedulePairing = () => {
    const at = nextDeadline(state);
    if (at === null || at >= pairTimerAt) return;
    if (pairTimer) clearTimeout(pairTimer);
    pairTimerAt = at;
    pairTimer = setTimeout(() => {
      pairTimer = null;
      pairTimerAt = Infinity;
      publish(expire(state, Date.now()));
    }, Math.max(0, at - Date.now()));
  };

  // Rolling counts age out even when nothing new arrives.
  const countsTick = setInterval(() => {
    if (hub.clients.size && state.graph.nodes.size) broadcast(hub, [{ type: 'counts', data: currentCounts(state, Date.now()) }]);
  }, COUNTS_EVERY_MS);

  const api = createServer(
    apiHandler({
      port: opts.port,
      otlpPort: opts.otlpPort,
      openStream: (req, res) => connect(hub, req, res, snapshot(state, Date.now())),
      span: (id) => spanView(state, id),
      trace: (id) => traceView(state, id),
      clear: () => {
        if (pairTimer) clearTimeout(pairTimer);
        pairTimer = null;
        pairTimerAt = Infinity;
        broadcast(hub, clearState(state));
      },
      spanCount: () => spanCount(state),
    }),
  );
  const receiver = createServer(
    receiverHandler({
      onSpans: (spans) => publish(ingestSpans(state, spans, Date.now())),
      onLogs: (logs) => publish(ingestLogs(state, logs)),
    }),
  );

  const stopTimers = () => {
    clearInterval(countsTick);
    if (pairTimer) clearTimeout(pairTimer);
    if (countsTimer) clearTimeout(countsTimer);
  };
  try {
    await listen(api, opts.port, '--port');
    await listen(receiver, opts.otlpPort, '--otlp-port');
  } catch (err) {
    stopTimers();
    closeHub(hub);
    api.close();
    receiver.close();
    throw err;
  }

  return {
    close: async () => {
      stopTimers();
      closeHub(hub);
      api.closeAllConnections();
      receiver.closeAllConnections();
      await Promise.all([new Promise((r) => api.close(r)), new Promise((r) => receiver.close(r))]);
    },
  };
}

/**
 * @param {import('node:http').Server} server
 * @param {number} port
 * @param {string} flag
 * @returns {Promise<void>}
 */
function listen(server, port, flag) {
  return new Promise((resolve, reject) => {
    /** @param {NodeJS.ErrnoException} err */
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') reject(new PortInUseError(port, flag));
      else reject(err);
    };
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
}
