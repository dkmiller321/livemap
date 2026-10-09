import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openCommand, openUrl } from '../src/cli/open.mjs';

const URL = 'http://127.0.0.1:4400';

test('--open uses the platform opener', () => {
  assert.deepEqual(openCommand('darwin', URL), { command: 'open', args: [URL] });
  assert.deepEqual(openCommand('linux', URL), { command: 'xdg-open', args: [URL] });
  assert.deepEqual(openCommand('win32', URL), { command: 'cmd', args: ['/c', 'start', '""', `"${URL}"`] });
});

test('openUrl spawns the opener detached and lets it go', () => {
  /** @type {any[]} */
  const calls = [];
  let unref = false;
  openUrl(URL, {
    platform: 'linux',
    spawner: (command, args, options) => {
      calls.push({ command, args, options });
      return { unref: () => (unref = true), on: () => {} };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'xdg-open');
  assert.deepEqual(calls[0].args, [URL]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(unref, true);
});

test('a failing opener is reported, not thrown', () => {
  /** @type {Error|null} */
  let reported = null;
  openUrl(URL, {
    platform: 'darwin',
    onError: (err) => (reported = err),
    spawner: () => ({ unref: () => {}, on: (_event, cb) => cb(new Error('no opener')) }),
  });
  assert.equal(/** @type {any} */ (reported)?.message, 'no opener');
});
