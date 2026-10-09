# VERIFICATION.md

Claude Code appends one section here per stage, and a final summary at acceptance. Each stage section lists the commands run with their pass and fail counts, every scenario walked through the `playwright-headless` MCP server as `E2E-xx: pass | fail | spec only — note`, and anything surprising. Nothing is recorded as passing unless it was actually run.

## Stage 0 — Skeleton (2026-10-09)

Commands:

- `npm run typecheck` — clean. A probe file with a deliberate type error was rejected (`TS2322`), so `checkJs` is really checking.
- `npm test` — 12 passed, 0 failed (args parsing, `--open` with an injected opener).
- `npx playwright test --list` — 42 specs in 6 files compile (E2E-00 to E2E-41; the 3 `@smoke` specs are excluded unless `RUN_SMOKE=1`).
- `npx playwright test --retries=0` (whole suite) — 4 passed, 38 failed in 5.6 min. Passed: E2E-00, E2E-06, E2E-39, E2E-40. E2E-01 failed on the non-loopback refusal check (see below); everything needing the page's feed, map or detail failed as expected.
- After the E2E-01 fix: `npx playwright test -g "@stage0" --retries=0` — 2 passed, 0 failed.

MCP walkthrough (`playwright-headless`, against `node bin/livemap.mjs` after `POST /api/clear`):

- E2E-00: pass — navigated to `http://127.0.0.1:4400/`; snapshot shows status `Live`, heading "Waiting for traffic" and the four hookup lines with port 4318; `window.__livemap.stats()` returned `connected: true` and 0 for every counter; `/healthz` returned `{"status":"ok","spans":0}`; `/api/clear` returned `{"cleared":true}`.
- E2E-01: spec only — process spawning.

Surprises:

- A refused TCP connect on Windows takes about 2 s (measured 2,047 ms to 10.2.0.2:4490), longer than the helper's first 2 s socket timeout, so E2E-01 first reported `timeout` instead of `ECONNREFUSED`. The helper now waits up to 6 s; the assertion is unchanged.
- Importing `protobufjs` into the TypeScript helper through Playwright's loader crashed Node 22.17 with "Unexpected module status 3". Loading it with `createRequire` fixed it.
- E2E-06, E2E-39 and E2E-40 already pass because the receiver, buffer and CLI were drafted alongside the stage 0 skeleton, before the specs were written.
