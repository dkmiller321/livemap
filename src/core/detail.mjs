// What the detail panel shows for HTTP, database and failed spans.

/**
 * @param {Record<string, any>} a
 * @returns {{method: string, target: string, status: string}}
 */
export function httpInfo(a) {
  const target = a['url.full'] ?? a['http.url'] ?? a['http.route'] ?? a['http.target'] ?? a['url.path'] ?? '';
  return {
    method: String(a['http.request.method'] ?? a['http.method'] ?? ''),
    target: String(target),
    status: String(a['http.response.status_code'] ?? a['http.status_code'] ?? a['rpc.grpc.status_code'] ?? ''),
  };
}

/**
 * @param {Record<string, any>} a
 * @returns {{system: string, statement: string}}
 */
export function dbInfo(a) {
  return {
    system: String(a['db.system.name'] ?? a['db.system'] ?? ''),
    statement: String(a['db.query.text'] ?? a['db.statement'] ?? a['db.query.summary'] ?? ''),
  };
}

/**
 * The exception recorded on a failed span: the `exception` event first, then `error.type`
 * and the status message.
 * @param {{status: string, statusMessage: string, attributes: Record<string, any>, events: {name: string, attributes: Record<string, any>}[]}} span
 * @returns {{type: string, message: string, stack: string}|null}
 */
export function errorInfo(span) {
  const ex = span.events.find((e) => e.name === 'exception');
  if (ex) {
    return {
      type: String(ex.attributes['exception.type'] ?? span.attributes['error.type'] ?? ''),
      message: String(ex.attributes['exception.message'] ?? span.statusMessage ?? ''),
      stack: String(ex.attributes['exception.stacktrace'] ?? ''),
    };
  }
  if (span.status !== 'error' && span.attributes['error.type'] === undefined) return null;
  return {
    type: String(span.attributes['error.type'] ?? ''),
    message: span.statusMessage || '',
    stack: '',
  };
}
