// `--open`: opens the page in the default browser. The opener is injectable for tests.
import { spawn } from 'node:child_process';

/**
 * @typedef {(command: string, args: string[], options: {detached: boolean, stdio: 'ignore', windowsVerbatimArguments?: boolean}) => {unref: () => void, on: (event: 'error', cb: (err: Error) => void) => void}} Spawner
 */

/**
 * @param {string} platform
 * @param {string} url
 * @returns {{command: string, args: string[]}}
 */
export function openCommand(platform, url) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', `"${url}"`] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * @param {string} url
 * @param {{platform?: string, spawner?: Spawner, onError?: (err: Error) => void}} [opts]
 */
export function openUrl(url, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const spawner = opts.spawner ?? /** @type {Spawner} */ (/** @type {unknown} */ (spawn));
  const { command, args } = openCommand(platform, url);
  const child = spawner(command, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: platform === 'win32' });
  child.on('error', (err) => (opts.onError ?? (() => process.stderr.write(`livemap: could not open a browser: ${err.message}\n`)))(err));
  child.unref();
}
