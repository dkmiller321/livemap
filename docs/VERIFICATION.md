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

## Stage 4 — Hookups (2026-10-09)

Commands:

- `npm run examples:setup` — Node example installed (auto-instrumentations-node 0.81.0, openai 5.23.2, express 5.3.0); Python venv on Python 3.13.5 (found as `python`; `python3` is 3.8), FastAPI 0.143, uvicorn 0.54, openai 2.54 (after pinning), openai-v2 2.4b0, util-genai 1.1b0.
- First manual run of `/order/1042` showed only HTTP rows and an external node `127.0.0.1:4599` — no SQLite span and no LLM span. Three causes found and fixed (details in DECISIONS.md): openai 3.x / httpx2, util-genai 1.2b0 rename, and `Connection.execute` not traced. After the fixes the same request gave exactly the 5 nodes and 4 edges of E2E-25.
- `npm run typecheck` — clean. `npm test` — 87 passed, 0 failed.
- `npx playwright test -g "@stage0|…|@stage4" --retries=0` — 28 passed, 0 failed (36.3 s), with Playwright starting Livemap, the mock LLM and both examples. All five ports were free afterwards.
- `npx playwright test -g "@stage4" --retries=0 --repeat-each=5` — 20 passed, 0 failed (cross-process pairing held every time).
- After the waterfall layout tweak below: stages 0–4 with the default config — 28 passed.

MCP walkthrough (`playwright-headless`; Livemap from `node bin/livemap.mjs`, examples from `npm run examples:start`):

- E2E-24: pass — no `opentelemetry` in `examples/node-app/src` or `examples/python-app/app`; README has the four lines; `/hello` returned `{"reply":"Hello from the mock model."}`; nodes Outside, node-example (service), openai (llm), none containing 4599; rows `GET /hello` Outside → node-example and `chat mock-model` node-example → openai; detail: mock-model, 12 / 6, user "Please say hello.", response "Hello from the mock model." (content arrived as two log records).
- E2E-25: pass — `/order/1042` returned the expected JSON; nodes python-example, sqlite (db), openai (llm), node-example, Outside; edges `python-example>sqlite`, `python-example>openai`, `node-example>python-example`, `Outside>node-example`; one `node-example → python-example` row; SQLite row: `SELECT id, status FROM orders WHERE id = ?`; LLM row: mock-model, 18 / 5, user "Give the order status for order 1042 in one sentence.", response "Order 1042 has shipped."; waterfall of 12 rows from `d0 node-example GET /order/:id` through `d5 python-example GET /orders/{order_id}` to `d6 SELECT` and `d6 chat mock-model` (its HTTP child `d7 POST` only in the waterfall).
- E2E-26: pass — `/boom` 502 `{"error":"llm_failed"}`; rows `GET /boom` and `chat mock-model` both `error`.
- E2E-27: pass — `llm-bare`: gpt-x, 7, `Content not captured`; logs 200, metrics 200; reopened: user "ping from logs", response "pong from logs", no-content hidden; spans still 1.

Surprises:

- `opentelemetry-instrument` detaches on Windows (os.execl); see DECISIONS.md.
- Node start-up took ~10 s until the cloud resource detectors were turned off (now 1.3 s).
- Closing the detail panel left its waterfall rows in the DOM (hidden), which made a `[data-span-id=…]` selector ambiguous in the walkthrough. The panel now empties them on close.
- In the waterfall, the duration label overlapped full-width bars; it now has its own column.

## Stage 5 — Browser and polish (2026-10-09)

Commands:

- `examples/browser-page`: `npm install`, `npm run build` (esbuild, `dist/otel.js` 110 KB).
- `npm run typecheck` — clean.
- `npm test` — 90 passed, 0 failed (adds graph `unrecordCall`, engine: client after a server already drawn from Outside, and a taken-back call that keeps a shared edge).
- `npx playwright test --retries=0` (all 42) — 41 passed, 1 failed: E2E-34 timed out because the Hide content switch's track covered its invisible checkbox, so the click never reached it. Fixed in CSS; E2E-34 alone then passed.
- `npx playwright test` (all 42, default config) — 42 passed, 0 flaky (1.8 min), including E2E-38's 60-second load run.

MCP walkthrough (`playwright-headless`; Livemap, mock LLM and both examples running):

- E2E-28: pass — in a second tab, Ask showed "Hello from the mock model."; `browser-example` is `browser` in column 0, edge `browser-example>node-example`, one row with that route, the earlier `GET /hello` from Outside was taken back; the LLM row's waterfall starts `d0 browser-example GET`, then `d1 node-example GET /hello`. Preflight from `http://127.0.0.1:4501` got 204 with the origin echoed; from `https://evil.example` 204 with no `Access-Control-Allow-Origin`. (First attempt found the node as `service` and the call drawn twice; both fixed, see DECISIONS.md.)
- E2E-29: pass — both rows `llm`; nodes anthropic and openai are `llm`; oi-svc: claude-x, 11 / 4, "hi from openinference", "hello back"; ollm-svc: gpt-y, 9 / 2, "hi from openllmetry", "hey there".
- E2E-30: pass — counts shop-browser 0, shop-web 3, shop-api 6, redis 1, openai 3, postgresql 4, kafka 1, shop-worker 1; labels `3 · 38 ms` and `3 · 880 ms`; no node idle.
- E2E-31: pass — LLM filter 3 rows; errors only c05, c03, c01; `ORDERS` a10, b01, b03, b05, b06, b07, b08; node postgresql: chip `postgresql`, rows a10, a12, b05, b08; chip clear: 19; edge `kafka>shop-worker`: chip `kafka → shop-worker`, row b07.
- E2E-32: pass — paused (`Resume`), demo played, after 1 s 0 rows, 0 nodes, spans 27; Resume (`Pause`): 19 rows, 8 nodes; Clear button: 0 rows, empty state, spans 0.
- E2E-33: pass — 60 rows, scrolled to 300; three fresh entries: pill `3 new`, first row still `…3b`; pill click: scrollTop 0, pill hidden, first row `…3e` (index 62).
- E2E-34: pass — with Hide content on, all five messages, the response and `gen_ai.input.messages` read `[hidden]` (token counts still shown); b05 statement `[hidden]`; c01 target and `url.full` `http://localhost:3000/api/recommendations?[hidden]`; after a reload the switch was still on and the response hidden; off again showed "Order 1042 has shipped. …".
- E2E-35: pass — c04 via c03's waterfall: `UpstreamTimeout`, `recommendation model timed out`, stack with `at recommend (`; c05: `timeout`.
- E2E-36: pass — waterfall 2 rows, the late span posted, 3 rows with the panel still open and `…02` still selected.
- E2E-37: pass — with reduced motion emulated: row shown, `Outside>solo-api` flashed for ~330 ms (sampled every 20 ms), `particlesSpawned` 0.
- E2E-38: spec only (60 s) — 10-second look at `demo --rate 200`: 1,985 spans in 10 s, fps 57 at every sample, at most 94 particles in flight, 500 rows, status Live throughout. Screenshot reviewed.
- E2E-39: pass — Livemap on 4490/4491; after a kill the page read `Reconnecting…` within 116 ms; after a restart `Live` within 1,075 ms; `window.__marker` still 1.
- E2E-40: spec only (process spawning).
- E2E-41: pass — from the name filter, two Tabs reached the first feed row (c05); Enter opened the panel, Escape closed it and focus returned to c05; a13 reads `LLM`, a06 `Agent`.

Surprises:

- The fetch instrumentation ends spans ~300 ms after the response (it waits for resource timing), so a browser call always arrived after its server span's wait. Handled by taking back the Outside row; see DECISIONS.md.
- Playwright's `check()` on the Hide content switch waited out the 30 s test timeout without a clear error; the cause was an element covering the checkbox.
