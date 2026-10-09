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

## Stage 1 — Ingest and feed (2026-10-09)

Commands:

- `npm run typecheck` — clean.
- `npm test` — 42 passed, 0 failed (adds decode, classify with every kind-rule row, buffer, and the demo scenario: 27 spans, 19 rows by kind, 16 particles + 3 pulses, 3 error rows, 8 nodes, 8 edges, seeded variations). One failure on the first run was in the new test itself (fake clock values too short for its timestamp regex); fixed the test input.
- `npx playwright test -g "@stage0|@stage1" --retries=0` — 10 passed, 0 failed (11.7 s). Run again with the default config: 10 passed, 0 flaky.

MCP walkthrough (`playwright-headless` against `node bin/livemap.mjs`, data from `npm run fixtures:dump` posted with curl, `/api/clear` between scenarios):

- E2E-02: pass — one row `HTTP · GET /ping · 25 ms · Outside → solo-api · OK · 18:09:05`; response 200 `application/json`; `/healthz` spans 1.
- E2E-03: pass — protobuf answered 200 `application/x-protobuf` and gave the same row (id, kind, name, `25 ms`); gzipped JSON and gzipped protobuf each gave one span.
- E2E-04: pass — `{not json`, `ff ff ff ff` and an 11 MB body all got 400; `/healthz` spans 0, no rows, status still Live; `entry-http` then posted 200.
- E2E-05: pass — 9 rows with kinds http, db, llm (anthropic), agent, tool, queue, llm (legacy openai), db (mysql), http (legacy.example.com); no row for 07; `/api/span/e100000000000007` kind `internal`; spans 10.
- E2E-06: pass — six flood requests, spans 5000, first id 404, second and last 200, no rows.
- E2E-07: pass — demo exited 0 in 681 ms; traces 14 / 8 / 5; the sorted `[id, kind, name, duration, status]` list hashed to 261439029 on both runs.
- E2E-08: pass — rows read `GET /three`, `GET /two`, `GET /one`; after `entries-600`: 500 rows, `stats().rows` 500, first `GET /ping/599`, spans 603.
- E2E-09: pass — 19 row ids identical in order after a reload; status Live. (Nodes and edges are 0 at this stage; the map arrives in stage 2.)

Surprises: none in behaviour. Feed row times are local (the machine is UTC−4), as decided.
