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

## Stage 2 — Map (2026-10-09)

Commands:

- `npm run typecheck` — clean.
- `npm test` — 73 passed, 0 failed (adds pair: every pairing bullet, both arrival orders, the same-call-twice rule; graph: fixed slots, rows never reused, rolling counts, node merge; engine: pair in either order, learned addresses, server-first then client, orphan after 300 ms, external then late pairing correction, LLM HTTP child hidden whichever arrives first, eviction, feed cap, log attachment, trace depth, clear).
- `npx playwright test -g "@stage0|@stage1|@stage2" --retries=0` — 20 passed, 0 failed (26.9 s). Again with the default config: 20 passed, 0 flaky.

MCP walkthrough (`playwright-headless`, curl-fed fixtures, `/api/clear` between scenarios):

- E2E-10: pass — 8 nodes at the expected kinds and columns (shop-browser c0r0; shop-web, shop-api, shop-worker c1r0–r2; redis, openai, postgresql, kafka c2r0–r3), 8 edges, 19 rows, routes for a03/b06/b07/a06 as specified, `particlesSpawned + particlesMerged` 16, `pulsesSpawned` 3. Screenshot reviewed: columns, arrows, red failing edges and kind colours read clearly.
- E2E-11: pass — one row `front → back`, nodes front/back, edge `front>back`, 1 particle; `pair-again` added a second `front → back` row, still 2 nodes.
- E2E-12: pass — server then client 100 ms later gave one row and 2 nodes; `orphan` drew `Outside → orphan`.
- E2E-13: pass — `api.stripe.com` external in column 2; `orders.internal:9000` appeared, then after the late server span it was gone, `orders-svc` (service) and `front>orders-svc` existed, and the row read `front → orders-svc`.
- E2E-14: pass — Outside (outside, c0), solo-api (c1), edge `Outside>solo-api`, route `Outside → solo-api`.
- E2E-15: pass — front and back kept column, row and bounding box (394,93 and 394,177, 60×67) after the demo added 8 nodes; `window.__marker` still 1.
- E2E-16: pass — sampled every 100 ms: `shop-api>openai` and `openai` red from 36 ms before the demo process exited, last red at +1,860 ms, both `false` at +3,567 ms; 3 error rows reading `Error`, 16 ok; legend http, db, llm, agent, tool, queue.
- E2E-17: pass — `pulsesSpawned` 3, a06 is `agent` with route `shop-api`, a09/a11 `tool`, no edge from a node to itself.
- E2E-18: pass — sampled every 25 ms: the 800 ms span's particle was in flight for 792 ms, the 5 ms span's for 302 ms (clamped up), the 10 s span's for 1,999 ms (clamped down).
- E2E-19: pass — after 600 entries: `maxActiveParticles` 150, spawned 150 + merged 450 = 600.

Surprises:

- My first MCP attempt at E2E-16 sampled for 9 s and saw nothing: the gap between two tool calls was longer than the sampling window. Re-run with a 40 s window; not a product issue.
- A screenshot taken right after the demo showed node badges at 0: counts arrive in a `counts` event debounced by 50 ms. The stream showed the right values (shop-api 6, postgresql 4, …) a moment later.

## Stage 3 — Detail (2026-10-09)

Commands:

- `npm run typecheck` — clean.
- `npm test` — 87 passed, 0 failed (adds llm-content: current attributes, tool calls, input-only, no content, log events, JSON-string bodies, span events, older prompt/completion events, legacy indexed, OpenInference, source order, inference-details event; detail: HTTP, database and error extraction).
- `npx playwright test -g "@stage0|@stage1|@stage2|@stage3" --retries=0` — 24 passed, 0 failed (29.3 s). Again with the default config: 24 passed, 0 flaky.

MCP walkthrough (`playwright-headless`, demo played with `npm run demo:once`):

- E2E-20: pass — clicking a13 opened the panel: name `chat gpt-4o-mini`, kind `llm`, service `shop-api`, `880 ms`, `OK`; provider openai, model gpt-4o-mini, tokens 96 / 23, finish `stop`; system and user messages, response "Order 1042 has shipped. 3 units of SKU-7 are in stock."; only `shop-api>openai` highlighted. a07 showed finish `tool_calls` and two tool calls, `lookup_order` with 1042 and `check_stock` with SKU-7.
- E2E-21: pass — a10's waterfall had 14 rows a01…a14 in start order, depths 0,1,2,3,4,4,5,6,5,6,5,6,5,4 (a14 at 4, a08 at 6), only a10 selected; clicking a05's waterfall row showed `GET session:42`, db `redis`, only a05 selected.
- E2E-22: pass — b05: postgresql, `INSERT INTO orders (id, sku, qty) VALUES ($1, $2, $3)`; c01: GET, `http://localhost:3000/api/recommendations?user=42`, 502, Error; a03: POST, 200.
- E2E-23: pass — with a13 open, `/api/clear` closed the panel, emptied rows and nodes, showed the empty state, `/healthz` spans 0 and zeroed the particle and pulse counters; after a reload and a new demo, a13 again showed gpt-4o-mini. Screenshot of the panel reviewed.

Surprises: none.
