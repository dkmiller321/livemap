// Server-sent events: one hub, many pages.

/**
 * @typedef {object} Hub
 * @property {Set<import('node:http').ServerResponse>} clients
 * @property {ReturnType<typeof setInterval>} keepAlive
 */

/** @returns {Hub} */
export function createHub() {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  const keepAlive = setInterval(() => {
    for (const res of clients) res.write(': keep-alive\n\n');
  }, 15_000);
  keepAlive.unref();
  return { clients, keepAlive };
}

/**
 * Opens a stream and sends the snapshot first.
 * @param {Hub} hub
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {any} snapshot
 */
export function connect(hub, req, res, snapshot) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(`retry: 1000\n${frame('snapshot', snapshot)}`);
  hub.clients.add(res);
  req.on('close', () => hub.clients.delete(res));
}

/**
 * Sends a batch of events to every page in one write.
 * @param {Hub} hub
 * @param {{type: string, data: any}[]} events
 */
export function broadcast(hub, events) {
  if (events.length === 0 || hub.clients.size === 0) return;
  const chunk = events.map((e) => frame(e.type, e.data)).join('');
  for (const res of hub.clients) res.write(chunk);
}

/**
 * @param {Hub} hub
 */
export function closeHub(hub) {
  clearInterval(hub.keepAlive);
  for (const res of hub.clients) res.destroy();
  hub.clients.clear();
}

/**
 * @param {string} type
 * @param {any} data
 */
function frame(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
