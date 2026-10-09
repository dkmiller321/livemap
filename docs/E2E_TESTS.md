# E2E_TESTS.md — Acceptance contract

Every scenario below becomes a `@playwright/test` spec in `e2e/` **before** the feature is built. A stage is done when its scenarios, and every earlier stage's scenarios, pass. After that, you walk them again by hand through the `playwright-headless` MCP server.

Requirement IDs (I1, K3, M5…) and story IDs (U1…) refer to `docs/PRD.md`.

## 1. Test harness

### 1.1 Running

| Command | What it does |
|---|---|
| `npm run test:e2e` | Runs all specs except `@smoke`. Playwright's `webServer` starts Livemap (and the example servers, once they exist) unless `BASE_URL` is set. |
| `npm run test:e2e -- --grep @stage2` | Runs one stage's scenarios. |
| `BASE_URL=http://127.0.0.1:4400 OTLP_URL=http://127.0.0.1:4318 npm run test:e2e` | Runs against an already-running Livemap, such as the packed install used in final acceptance. |
| `RUN_SMOKE=1 npm run test:e2e -- --grep @smoke` | Runs the real-model smoke suite. Needs `LLM_API_KEY` and `LLM_MODEL`. |
| `npm test` | Unit tests (`node --test`). |
| `npm run typecheck` | `tsc --noEmit` with `checkJs` over `src/`, `bin/` and `public/`. |

Playwright config: Chromium only, headless, `workers: 1` (all specs share one Livemap process), `retries: 1`, trace on the first retry, default `expect` timeout 1,000 ms. Tags go in test titles, for example `test('E2E-11 @stage2 client and server spans pair into one call', …)`.

`webServer` entries (ports come from `.env`, defaults shown):

| # | Server | Command | Ready when |
|---|---|---|---|
| 1 | Livemap | `node bin/livemap.mjs --port 4400 --otlp-port 4318` | `GET http://127.0.0.1:4400/healthz` is 200 |
| 2 | Mock LLM | `node examples/mock-llm/server.mjs` | `GET http://127.0.0.1:4599/healthz` is 200 |
| 3 | Node example | `npm run example:node` | `GET http://127.0.0.1:4501/healthz` is 200 |
| 4 | Python example | `npm run example:python` | `GET http://127.0.0.1:4502/healthz` is 200 |

The config adds entries 2–4 only when `examples/python-app/.venv` exists (created by `npm run examples:setup` in stage 4). Before stage 4 the example specs fail at their first request. That is expected; do not skip them.

Specs that spawn their own Livemap process (E2E-01, E2E-39, E2E-40) use the command in `LIVEMAP_BIN` (default `node bin/livemap.mjs`), so final acceptance can point them at the packed install.

**Port 4317 is off limits.** KitForge listens on `127.0.0.1:4317` on this machine. No test and no Livemap code may bind it.

### 1.2 Reset

`POST /api/clear` (port 4400) empties the span buffer, nodes, edges, trace index, address table and every pending pairing timer, then broadcasts `clear`. It returns 200 `{"cleared":true}`. It is a real product endpoint (the Clear button uses it), so it is always on.

Every spec's `beforeEach`: call `POST /api/clear`, open `/`, wait for `connection-status` to read `Live`. Each test gets a fresh browser context, so `localStorage` starts empty.

On `clear`, the page closes the detail panel, empties the feed and map, shows the empty state, and zeroes every counter in `window.__livemap.stats()`.

### 1.3 Helpers (`e2e/helpers/`)

| Helper | What it does |
|---|---|
| `clear()` | `POST /api/clear` |
| `span(overrides)` | Builds one OTLP JSON span with defaults (kind, ids, start time = now − duration, status OK) |
| `postTraces(body, { contentType, gzip })` | Posts to `OTLP_URL/v1/traces`. Defaults to JSON, no gzip. Returns the response. |
| `postLogs(body)` / `postMetrics(body)` | Posts JSON to `/v1/logs` and `/v1/metrics` |
| `toProtobuf(json)` | Encodes an OTLP JSON export request as protobuf, using the same bundled descriptor as the receiver |
| `playDemoOnce()` | Runs `LIVEMAP_BIN demo --once --target OTLP_URL` and resolves with the exit code |
| `startDemo({ rate, seed })` | Starts `LIVEMAP_BIN demo --rate N --seed S --target OTLP_URL`; returns `{ stop() }` |
| `stats(page)` | `page.evaluate(() => window.__livemap.stats())` |
| `spawnLivemap(args)` | Starts a separate Livemap process; returns `{ stdout, stderr, exit, kill(signal) }` |

All data reaches Livemap over HTTP through the real receiver. No helper may write into Livemap's memory or call internal functions.

### 1.4 Inspection: things tests cannot read from pixels

Particles are drawn on a `<canvas>`. Tests read counts, never pixels.

`window.__livemap.stats()` is always present and read-only. It returns:

| Field | Meaning |
|---|---|
| `connected` | `true` while the event stream is open |
| `nodes`, `edges`, `rows` | Counts currently on the page |
| `activeParticles` | Particles in flight right now |
| `maxActiveParticles` | Highest `activeParticles` since the last clear |
| `particlesSpawned` | Particles started since the last clear. A merged particle counts once. |
| `particlesMerged` | Spans folded into an existing particle since the last clear |
| `pulsesSpawned` | Agent and tool ring pulses since the last clear |
| `fps` | Frames drawn in the last full second |

So `particlesSpawned + particlesMerged` equals the number of drawn calls that are not pulses.

Server state is read through `GET /healthz`, `GET /api/span/:spanId` (404 when the span is not in the buffer) and `GET /api/trace/:traceId`.

Nodes and edges are SVG elements that carry their state as attributes:

| Element | Attributes |
|---|---|
| `node` | `data-node-id`, `data-kind` (`browser`, `outside`, `service`, `db`, `queue`, `llm`, `external`), `data-column` (`0`, `1`, `2`), `data-row`, `data-error` (`true` during the red flash), `data-idle` (`true` once dimmed) |
| `edge` | `data-edge-id` (`<source id>><target id>`), `data-error`, `data-highlighted` (`true` while its span is selected), `data-flash` (`true` during the reduced-motion highlight) |
| `feed-row` | `data-span-id`, `data-kind` (`http`, `db`, `llm`, `agent`, `tool`, `queue`), `data-status` (`ok`, `error`) |
| `waterfall-row` | `data-span-id`, `data-depth`, `data-selected`, `data-service` |

Node ids: a service or browser node's id is its `service.name`. An external node's id is its name: the database system (`postgresql`), LLM provider (`openai`), queue system (`kafka`), or host (`api.stripe.com`, with `:port` appended unless the port is 80 or 443). The entry node's id is `Outside`.

Text formats tests rely on:

- `row-route`: `<source name> → <target name>`. For a pulse, just the service name.
- `row-duration` and `detail-duration`: under 1,000 ms, `N ms` (whole number); otherwise seconds with two decimals, `1.84 s`.
- `row-status` and `detail-status`: `OK` or `Error`.
- `row-time`: `HH:MM:SS`.
- `row-kind`: `HTTP`, `DB`, `LLM`, `Agent`, `Tool`, `Queue`.
- `edge-label`: `<count> · <median duration>`, for example `3 · 38 ms`.
- Hidden content: the literal text `[hidden]`.

### 1.5 The demo scenario (`livemap demo --once`)

This is the fixed data most scenarios use. `--once` posts three export requests, trace A, then B, then C, each holding every span of that trace grouped by service in the order listed. Start times are anchored so the latest span ends at send time. It exits 0 after the third 200 response, in under 2 s. Ids, names, attributes and durations are the same on every run.

Trace ids: A = `a` × 32, B = `b` × 32, C = `c` × 32. Span ids: the letter, thirteen zeros, then the two digits shown (`a01` = `a000000000000001`, `a13` = `a000000000000013`).

Services: `shop-browser` (`telemetry.sdk.language=webjs`), `shop-web`, `shop-api`, `shop-worker`.

| ID | Service | OTel kind | Name | Parent | Start +ms | Duration ms | Status | Livemap kind | Drawn as |
|---|---|---|---|---|---|---|---|---|---|
| a01 | shop-browser | CLIENT | `POST /api/ask` | — | 0 | 1840 | OK | http | shop-browser → shop-web |
| a02 | shop-web | SERVER | `POST /api/ask` | a01 | 20 | 1800 | OK | http | not drawn (paired) |
| a03 | shop-web | CLIENT | `POST /v1/answer` | a02 | 40 | 1760 | OK | http | shop-web → shop-api |
| a04 | shop-api | SERVER | `POST /v1/answer` | a03 | 50 | 1740 | OK | http | not drawn (paired) |
| a05 | shop-api | CLIENT | `GET session:42` | a04 | 55 | 4 | OK | db | shop-api → redis |
| a06 | shop-api | INTERNAL | `invoke_agent support-agent` | a04 | 70 | 1650 | OK | agent | pulse on shop-api |
| a07 | shop-api | CLIENT | `chat gpt-4o-mini` | a06 | 75 | 620 | OK | llm | shop-api → openai |
| a08 | shop-api | CLIENT | `POST` | a07 | 80 | 610 | OK | http | not drawn (same call as a07) |
| a09 | shop-api | INTERNAL | `execute_tool lookup_order` | a06 | 700 | 45 | OK | tool | pulse on shop-api |
| a10 | shop-api | CLIENT | `SELECT shop.orders` | a09 | 704 | 38 | OK | db | shop-api → postgresql |
| a11 | shop-api | INTERNAL | `execute_tool check_stock` | a06 | 750 | 30 | OK | tool | pulse on shop-api |
| a12 | shop-api | CLIENT | `SELECT shop.stock` | a11 | 754 | 22 | OK | db | shop-api → postgresql |
| a13 | shop-api | CLIENT | `chat gpt-4o-mini` | a06 | 790 | 880 | OK | llm | shop-api → openai |
| a14 | shop-api | INTERNAL | `render answer` | a04 | 1725 | 12 | OK | internal | waterfall only |
| b01 | shop-browser | CLIENT | `POST /api/orders` | — | 0 | 240 | OK | http | shop-browser → shop-web |
| b02 | shop-web | SERVER | `POST /api/orders` | b01 | 12 | 215 | OK | http | not drawn (paired) |
| b03 | shop-web | CLIENT | `POST /v1/orders` | b02 | 20 | 190 | OK | http | shop-web → shop-api |
| b04 | shop-api | SERVER | `POST /v1/orders` | b03 | 26 | 180 | OK | http | not drawn (paired) |
| b05 | shop-api | CLIENT | `INSERT shop.orders` | b04 | 40 | 41 | OK | db | shop-api → postgresql |
| b06 | shop-api | PRODUCER | `send orders` | b04 | 90 | 6 | OK | queue | shop-api → kafka |
| b07 | shop-worker | CONSUMER | `process orders` | b06 | 110 | 320 | OK | queue | kafka → shop-worker |
| b08 | shop-worker | CLIENT | `UPDATE shop.orders` | b07 | 300 | 27 | OK | db | shop-worker → postgresql |
| c01 | shop-browser | CLIENT | `GET /api/recommendations` | — | 0 | 2100 | ERROR | http | shop-browser → shop-web |
| c02 | shop-web | SERVER | `GET /api/recommendations` | c01 | 10 | 2080 | ERROR | http | not drawn (paired) |
| c03 | shop-web | CLIENT | `GET /v1/recommendations` | c02 | 20 | 2060 | ERROR | http | shop-web → shop-api |
| c04 | shop-api | SERVER | `GET /v1/recommendations` | c03 | 25 | 2050 | ERROR | http | not drawn (paired) |
| c05 | shop-api | CLIENT | `chat gpt-4o-mini` | c04 | 40 | 2000 | ERROR | llm | shop-api → openai |

Totals: 27 spans, 19 feed rows (http 6, db 5, llm 3, agent 1, tool 2, queue 2), 16 particles, 3 pulses, 3 error rows (c01, c03, c05), 8 nodes, 8 edges.

Attributes (current OpenTelemetry names):

| Spans | Attributes |
|---|---|
| a01, b01, c01 | `http.request.method`, `url.full` (`http://localhost:3000/api/ask`, `…/api/orders`, `…/api/recommendations?user=42`), `server.address=localhost`, `server.port=3000`, `http.response.status_code` (200, 201, 502) |
| a02, b02, c02 | `http.request.method`, `http.route`, `http.response.status_code` (200, 201, 502) |
| a03, b03, c03 | `http.request.method`, `url.full` (`http://shop-api:8081/v1/answer`, `…/v1/orders`, `…/v1/recommendations?user=42`), `server.address=shop-api`, `server.port=8081`, `http.response.status_code` (200, 201, 503) |
| a04, b04, c04 | `http.request.method`, `http.route`, `http.response.status_code` (200, 201, 503). c04 also has an `exception` event: `exception.type=UpstreamTimeout`, `exception.message=recommendation model timed out`, `exception.stacktrace` = `UpstreamTimeout: recommendation model timed out\n    at recommend (/app/src/recommend.js:42:11)` |
| a05 | `db.system.name=redis`, `db.query.text=GET session:42` |
| a10 | `db.system.name=postgresql`, `db.query.text=SELECT id, status FROM orders WHERE id = $1` |
| a12 | `db.system.name=postgresql`, `db.query.text=SELECT qty FROM stock WHERE sku = $1` |
| b05 | `db.system.name=postgresql`, `db.query.text=INSERT INTO orders (id, sku, qty) VALUES ($1, $2, $3)` |
| b08 | `db.system.name=postgresql`, `db.query.text=UPDATE orders SET status = $1 WHERE id = $2` |
| a06 | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name=support-agent`, `gen_ai.provider.name=openai` |
| a09, a11 | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name` (`lookup_order`, `check_stock`), `gen_ai.tool.call.id` (`call_1`, `call_2`) |
| a07 | `gen_ai.operation.name=chat`, `gen_ai.provider.name=openai`, `gen_ai.request.model=gpt-4o-mini`, `gen_ai.usage.input_tokens=42`, `gen_ai.usage.output_tokens=17`, `gen_ai.response.finish_reasons=["tool_calls"]`, `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages` |
| a13 | As a07, with `input_tokens=96`, `output_tokens=23`, `finish_reasons=["stop"]` |
| c05 | `gen_ai.operation.name=chat`, `gen_ai.provider.name=openai`, `gen_ai.request.model=gpt-4o-mini`, `error.type=timeout`, `gen_ai.input.messages` |
| a08 | `http.request.method=POST`, `url.full=https://api.openai.com/v1/chat/completions`, `server.address=api.openai.com`, `server.port=443` |
| b06, b07 | `messaging.system=kafka`, `messaging.destination.name=orders`, `messaging.operation.type` (`send`, `process`) |

LLM content. Messages use the GenAI JSON shape `[{"role":…,"parts":[{"type":"text","content":…}]}]`, stored as a JSON string attribute.

| Span | System instructions | Input messages | Output |
|---|---|---|---|
| a07 | `You are a support agent for an online shop.` | user: `Where is my order 1042?` | Two tool calls: `lookup_order` with `{"order_id":1042}` (id `call_1`), `check_stock` with `{"sku":"SKU-7"}` (id `call_2`) |
| a13 | same | user: `Where is my order 1042?`; assistant: the two tool calls; tool: `{"status":"shipped"}`; tool: `{"qty":3}` | assistant text: `Order 1042 has shipped. 3 units of SKU-7 are in stock.` |
| c05 | none | user: `Recommend three products for user 42.` | none |

Without `--once`, the demo plays randomised variations of these three traces for ever at `--rate` spans per second (default 10), seeded by `--seed`, with about one trace in ten failing.

### 1.6 Other fixtures (`e2e/fixtures/`)

Built with `span()` and posted as JSON unless a scenario says otherwise. Every client HTTP span carries `http.request.method`, `server.address` and `server.port`.

| Fixture | Spans |
|---|---|
| `entry-http` | `f100000000000001`: SERVER, service `solo-api`, name `GET /ping`, `http.request.method=GET`, `http.route=/ping`, status 200, 25 ms, no parent |
| `pair` | `d100000000000001`: CLIENT, service `front`, name `GET /items`, to `back.internal:8080`, 40 ms. `d100000000000002`: SERVER, service `back`, name `GET /items`, parent `…01`, 30 ms. Client first in the request. |
| `pair-again` | `d100000000000003`: CLIENT, service `front`, name `GET /items`, to `back.internal:8080`. No server span. |
| `orphan` | `d200000000000001`: SERVER, service `orphan`, name `GET /orphan`, parent `d2000000000000ff`, which is never sent |
| `stripe` | `d300000000000001`: CLIENT, service `front`, name `POST`, to `api.stripe.com:443` |
| `late` | `d400000000000001`: CLIENT, service `front`, name `GET`, to `orders.internal:9000`. `d400000000000002`: SERVER, service `orders-svc`, name `GET /orders`, parent `…01`. Posted separately. |
| `kinds` | One trace, service `kinds-svc`, ids `e100000000000001`–`…0a`: (01) SERVER with `http.request.method=GET`, no parent; the rest are children of 01: (02) `db.system.name=postgresql`; (03) `gen_ai.operation.name=chat`, `gen_ai.provider.name=anthropic`; (04) `gen_ai.operation.name=invoke_agent`; (05) `gen_ai.operation.name=execute_tool`; (06) PRODUCER with `messaging.system=rabbitmq`; (07) INTERNAL, no attributes; (08) legacy LLM: `gen_ai.system=openai`, no operation name; (09) legacy db: `db.system=mysql`; (0a) legacy HTTP client: `http.method=GET`, `net.peer.name=legacy.example.com`, `net.peer.port=443` |
| `flood(n)` | `n` INTERNAL spans, service `flood`, no attributes, ids `e2` + the index as 14 hex digits, in requests of at most 1,000 |
| `entries(n)` | `n` copies of `entry-http` with ids `e3` + the index as 14 hex digits and names `GET /ping/<index>`, in one request |
| `llm-bare` | `d500000000000001`: CLIENT, service `logs-svc`, name `chat gpt-x`, `gen_ai.operation.name=chat`, `gen_ai.provider.name=openai`, `gen_ai.request.model=gpt-x`, input tokens 7, output tokens 3, no message attributes |
| `other-conventions` | `d600000000000001`: service `oi-svc`, `openinference.span.kind=LLM`, `llm.provider=anthropic`, `llm.model_name=claude-x`, `llm.token_count.prompt=11`, `llm.token_count.completion=4`, `llm.input_messages.0.message.role=user`, `llm.input_messages.0.message.content=hi from openinference`, `llm.output_messages.0.message.role=assistant`, `llm.output_messages.0.message.content=hello back`. `d600000000000002`: service `ollm-svc`, `gen_ai.system=openai`, `llm.request.type=chat`, `gen_ai.request.model=gpt-y`, `gen_ai.usage.prompt_tokens=9`, `gen_ai.usage.completion_tokens=2`, `gen_ai.prompt.0.role=user`, `gen_ai.prompt.0.content=hi from openllmetry`, `gen_ai.completion.0.role=assistant`, `gen_ai.completion.0.content=hey there` |
| `late-trace` | `d700000000000001`: SERVER, service `late-svc`, name `GET /late`, no parent. `d700000000000002` and `d700000000000003`: db children (`db.system.name=sqlite`). Span 03 is posted later. |

### 1.7 The mock LLM and the example apps (stage 4 onwards)

No test except `@smoke` may reach a real model. The examples talk to `examples/mock-llm/server.mjs`, an OpenAI-compatible server on port 4599. The examples use the real `openai` SDKs, so the real instrumentation, export and Livemap pipeline all run unchanged.

**Mock LLM.** `POST /v1/chat/completions`, non-streaming. It looks at the **last user message**, lower-cased, and picks the first script whose trigger it contains. Replies always carry `"model":"mock-model"`, `"finish_reason":"stop"` and the usage shown. `GET /healthz` returns 200.

| Script | Trigger (contains) | Reply | prompt / completion tokens |
|---|---|---|---|
| L1 hello | `say hello` | `Hello from the mock model.` | 12 / 6 |
| L2 order | `order status` | `Order 1042 has shipped.` | 18 / 5 |
| L3 fail | `fail` | HTTP 500 with `{"error":{"message":"mock failure","type":"server_error"}}` | — |
| default | (no match) | `Mock: no script for this prompt.` | 5 / 7 |

**Example apps.** Each reads `LLM_BASE_URL` (default `http://127.0.0.1:4599/v1`), `LLM_API_KEY` (default `mock-key`) and `LLM_MODEL` (default `mock-model`), and creates its OpenAI client with retries off (`maxRetries: 0` / `max_retries=0`). While `MOCK_LLM=1` in `.env` (the default), the npm scripts ignore the `LLM_*` values there and point the examples at the mock.

| App | Port | `service.name` | Routes |
|---|---|---|---|
| `examples/node-app` (Express) | 4501 | `node-example` | `GET /healthz`. `GET /hello`: chat with user message `Please say hello.`, returns `{"reply":"<content>"}`. `GET /order/:id`: fetches `http://127.0.0.1:4502/orders/:id` and returns its JSON. `GET /boom`: chat with `Please fail.`; on error returns 502 `{"error":"llm_failed"}`. `GET /`: the browser example page (stage 5). |
| `examples/python-app` (FastAPI) | 4502 | `python-example` | `GET /healthz`. `GET /orders/{id}`: runs `SELECT id, status FROM orders WHERE id = ?` on an in-memory SQLite database seeded with order 1042 (`shipped`), then chats with `Give the order status for order 1042 in one sentence.`, and returns `{"order":1042,"status":"shipped","summary":"<content>"}`. Unknown id: 404. |
| `examples/browser-page` | served at `http://127.0.0.1:4501/` | `browser-example` | A page with `ask-button`; clicking it fetches `/hello` and puts the reply in `ask-result`. Its OpenTelemetry setup is bundled with esbuild into one script, exports OTLP JSON to `http://127.0.0.1:4318/v1/traces`, and propagates `traceparent` to same-origin fetches. |

**The hookup must stay outside application code.** Application source is `examples/node-app/src/**`, `examples/python-app/app/**` and `examples/browser-page/src/app.js`. None of it may contain the string `opentelemetry` in any letter case. Instrumentation comes from start flags, environment variables in the npm scripts, and at most one separate setup file per example.

### 1.8 Selector contract (`data-testid`)

| testid | Element |
|---|---|
| `connection-status` | Reads `Live` while the event stream is open, `Reconnecting…` otherwise |
| `empty-state` | Visible only while no span has arrived; contains `Waiting for traffic` |
| `hookup-lines` | The four hookup lines inside the empty state |
| `map` | The map container |
| `node` (multiple) | One per node; attributes in 1.4 |
| `node-label` | Node name, inside `node` |
| `node-count` | Calls received in the last 60 s, inside `node` |
| `edge` (multiple) | One per edge; attributes in 1.4. Has a click area at least 12 px wide. |
| `edge-label` | Count and median duration for the edge |
| `legend` / `legend-item` (multiple, `data-kind`) | Particle colour key |
| `feed` | Scrollable feed container |
| `feed-row` (multiple) | One per drawn call or pulse; focusable; attributes in 1.4 |
| `row-kind` / `row-name` / `row-route` / `row-duration` / `row-status` / `row-time` | Cells inside `feed-row` |
| `filter-kind` | Select: `all`, `http`, `db`, `llm`, `agent`, `tool`, `queue` |
| `filter-errors` | "Errors only" checkbox |
| `filter-text` | Name filter input |
| `filter-chip` / `filter-chip-clear` | Shows the node or edge the feed is filtered to, and removes that filter |
| `new-rows-pill` | "N new" pill, visible only while the feed is scrolled down and rows are waiting |
| `pause-button` | Reads `Pause`, or `Resume` while paused |
| `clear-button` | Clears everything |
| `hide-content-toggle` | "Hide content" checkbox |
| `detail-panel` / `detail-close` | The detail panel and its close button |
| `detail-name` / `detail-kind` / `detail-service` / `detail-start` / `detail-duration` / `detail-status` | Span summary |
| `detail-attributes` / `attr-row` (multiple, `data-key`) | Every attribute as key and value |
| `llm-provider` / `llm-model` / `llm-input-tokens` / `llm-output-tokens` / `llm-finish-reason` | LLM summary |
| `llm-message` (multiple, `data-role`) | Each input message |
| `llm-response` | The assistant's text reply |
| `llm-tool-call` (multiple, `data-tool-name`) | Each tool call the model asked for, with its arguments |
| `llm-no-content` | Reads `Content not captured`; visible only when no content was found |
| `http-method` / `http-target` / `http-status` | HTTP detail. `http-target` is the full URL when known, otherwise the route. |
| `db-system` / `db-statement` | Database detail |
| `error-type` / `error-message` / `error-stack` | Failure detail |
| `waterfall` / `waterfall-row` (multiple) | Trace waterfall; attributes in 1.4 |

Browser example page: `ask-button`, `ask-result`.

## 2. Scenarios

Each scenario starts from a cleared Livemap with the page open at `/` (1.2). "Post X" means `postTraces` with fixture X. "Play the demo" means `playDemoOnce()` and waiting for exit code 0. Unless a scenario gives a time, "appears" means within 1 s. Span ids are written short (`a13`) for demo spans.

### Stage 0 — Skeleton

**E2E-00 @stage0 app boots (X1, X6, M7).** `GET /healthz` returns 200 with `{"status":"ok","spans":0}`. The page shows `empty-state` containing `Waiting for traffic`. `hookup-lines` contains these four lines:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_BSP_SCHEDULE_DELAY=200
```

`connection-status` reads `Live`. `stats()` reports `connected: true` and 0 for `nodes`, `edges` and `rows`. `POST /api/clear` returns 200 with `{"cleared":true}`.

**E2E-01 @stage0 command line and port clash (X1, X2, X3, X7, I6).** With the shared Livemap running on 4400 and 4318:

- `spawnLivemap(['--port','4400','--otlp-port','4491'])` exits with code 1 within 3 s, and stderr contains `Port 4400 is already in use. Choose another with --port.`
- `spawnLivemap(['--port','4490','--otlp-port','4318'])` exits with code 1, and stderr contains `Port 4318 is already in use. Choose another with --otlp-port.`
- `spawnLivemap(['--port','4490','--otlp-port','4491'])`: within 1 s stdout contains `http://127.0.0.1:4490` and the four hookup lines with port `4491`. `GET http://127.0.0.1:4490/healthz` returns 200. If the machine has a non-loopback IPv4 address, connecting to that address on port 4490 or 4491 is refused. After `SIGINT` the process exits within 1 s.

### Stage 1 — Ingest and feed

**E2E-02 @stage1 a JSON span becomes a feed row (I1, I3, K1, K2, F1, F2).** Post `entry-http`. The response is 200, has content type `application/json`, and its body parses as a JSON object. A `feed-row` with `data-span-id="f100000000000001"` is visible less than 500 ms after the response returned. It has `data-kind="http"`, `data-status="ok"`, `row-name` `GET /ping`, `row-kind` `HTTP`, `row-duration` `25 ms`, `row-status` `OK`, and `row-time` matching `^\d{2}:\d{2}:\d{2}$`. There is exactly one `feed-row`. `empty-state` is hidden. `/healthz` reports `spans: 1`.

**E2E-03 @stage1 protobuf and gzip give the same row (I1, I2, I3).** Post `entry-http` encoded with `toProtobuf`, content type `application/x-protobuf`. The response is 200 with content type `application/x-protobuf`. Exactly one row exists, with the same span id, name, kind and duration as in E2E-02. Clear, then post the JSON form with `Content-Encoding: gzip`: the same single row. Clear, then post gzipped protobuf: the same single row.

**E2E-04 @stage1 bad input is rejected and the process survives (I4, Reliability).** Each of these returns 400: the body `{not json` as `application/json`; the four bytes `ff ff ff ff` as `application/x-protobuf`; an 11 MB JSON body. After all three, `/healthz` returns 200 with `spans: 0` and no `feed-row` exists. Then post `entry-http`: its row appears. **This is the failure test:** a rejected request stores nothing, and never takes the receiver down.

**E2E-05 @stage1 every kind is recognised (K2, K5, K7).** Post `kinds`. Within 1.5 s the feed has exactly 9 rows. By span id suffix, `data-kind` is: 01 `http`, 02 `db`, 03 `llm`, 04 `agent`, 05 `tool`, 06 `queue`, 08 `llm`, 09 `db`, 0a `http`. No row exists for 07. `GET /api/span/e100000000000007` returns 200 with `"kind":"internal"`. `/healthz` reports `spans: 10`.

**E2E-06 @stage1 the buffer drops the oldest span (I5).** Post `flood(5001)`. `/healthz` reports `spans: 5000`. `GET /api/span/<first id>` returns 404. `GET /api/span/<second id>` and `GET /api/span/<last id>` return 200. No `feed-row` exists.

**E2E-07 @stage1 the demo is the same every run (X4, X5).** Play the demo: exit code 0 within 5 s. `/healthz` reports `spans: 27`. `GET /api/trace/<A>` returns 14 spans, B returns 8, C returns 5. Collect `[span id, kind, name, duration text, status]` for every row, sorted by span id. Clear and play the demo again: the collected list is identical.

**E2E-08 @stage1 newest first, at most 500 rows (F1, F2).** Post three `entry-http` variants in three requests, named `GET /one`, `GET /two`, `GET /three`. The first `feed-row` is `GET /three` and the third is `GET /one`. Then post `entries(600)`. There are exactly 500 `feed-row` elements, `stats().rows` is 500, the first row is `GET /ping/599`, and `/healthz` reports `spans: 603`.

**E2E-09 @stage1 a reload loses nothing (persistence).** Play the demo. Record the row span ids in order, and `stats().nodes` and `stats().edges`. Reload the page. After `connection-status` reads `Live`, all three match what was recorded.

### Stage 2 — Map

**E2E-10 @stage2 the demo draws the whole app (K1, K3, K4, K9, M1, M2, U1).** Play the demo. Exactly 8 `node` elements exist:

| `data-node-id` | `data-kind` | `data-column` |
|---|---|---|
| `shop-browser` | `browser` | 0 |
| `shop-web`, `shop-api`, `shop-worker` | `service` | 1 |
| `redis`, `postgresql` | `db` | 2 |
| `openai` | `llm` | 2 |
| `kafka` | `queue` | 2 |

No two nodes share the same column and row. Exactly 8 `edge` elements exist, with ids `shop-browser>shop-web`, `shop-web>shop-api`, `shop-api>redis`, `shop-api>postgresql`, `shop-api>openai`, `shop-api>kafka`, `kafka>shop-worker`, `shop-worker>postgresql`. No node is named `Outside` or contains `api.openai.com`.

The feed has exactly 19 rows: 6 `http`, 5 `db`, 3 `llm`, 1 `agent`, 2 `tool`, 2 `queue`. No row exists for a02, a04, a08, a14, b02, b04, c02 or c04. `row-route` reads `shop-web → shop-api` for a03, `shop-api → kafka` for b06, `kafka → shop-worker` for b07 and `shop-api` for a06. `stats()` reports `particlesSpawned + particlesMerged` = 16 and `pulsesSpawned` = 3.

**E2E-11 @stage2 client and server spans pair into one call (K4, pairing rule).** Post `pair`. Exactly one `feed-row` exists, for `d100000000000001`, with `row-route` `front → back`. Exactly 2 nodes exist, `front` and `back`. Exactly 1 edge exists, `front>back`. `stats().particlesSpawned` is 1. Then post `pair-again`: a second row appears with `row-route` `front → back`, and there are still exactly 2 nodes.

**E2E-12 @stage2 arrival order does not matter (pairing rule).** Post the server span of `pair` alone. Wait 100 ms, then post its client span alone. After 1 s, exactly one `feed-row` exists, for `d100000000000001`, and exactly 2 nodes exist. Then post `orphan`: within 1.5 s a row for `d200000000000001` appears with `row-route` `Outside → orphan`.

**E2E-13 @stage2 unknown hosts become external nodes, and a late pairing corrects the map (K3, pairing rule).** Post `stripe`. Within 1.5 s a node `api.stripe.com` exists with `data-kind="external"` and `data-column="2"`, the edge `front>api.stripe.com` exists, and the row reads `front → api.stripe.com`. Post the client span of `late`; wait until node `orders.internal:9000` exists. Post the server span of `late`. Within 1 s: node `orders.internal:9000` is gone, node `orders-svc` exists with `data-kind="service"`, edge `front>orders-svc` exists, edge `front>orders.internal:9000` is gone, and the row for `d400000000000001` reads `front → orders-svc`. There is still exactly one row for `…01` and none for `…02`.

**E2E-14 @stage2 entry requests come from Outside (pairing rule).** Post `entry-http`. Node `Outside` exists with `data-kind="outside"` and `data-column="0"`. Node `solo-api` exists with `data-column="1"`. Edge `Outside>solo-api` exists. `row-route` reads `Outside → solo-api`.

**E2E-15 @stage2 nodes appear live and never move (M1, M3).** Set `window.__marker = 1`. Post `pair`. Record `data-column`, `data-row` and the bounding box of `front` and `back`. Play the demo. `front` and `back` have the same column, row and bounding box (within 1 px), there are now 10 nodes, and `window.__marker` is still 1.

**E2E-16 @stage2 failures show red, then fade (M5, U6).** Play the demo. Within 1 s of it exiting, edge `shop-api>openai` and node `openai` both have `data-error="true"`. 3.5 s after the demo exited, both have `data-error="false"`. Rows c01, c03 and c05 have `data-status="error"` and `row-status` `Error`; the other 16 rows have `data-status="ok"`. `legend` holds 6 `legend-item`s with `data-kind` `http`, `db`, `llm`, `agent`, `tool` and `queue`.

**E2E-17 @stage2 agent and tool steps pulse their service (K6, U5).** Play the demo. `stats().pulsesSpawned` is 3. Row a06 has `data-kind="agent"`, `row-name` `invoke_agent support-agent`, `row-route` `shop-api`. Rows a09 and a11 have `data-kind="tool"`. No edge id has the same node on both sides.

**E2E-18 @stage2 a particle travels for the span's duration (M4).** Post an `entry-http` variant with duration 800 ms. `activeParticles` becomes 1 within 500 ms. 400 ms after that it is still 1; 1,500 ms after that it is 0. Repeat with duration 5 ms: it returns to 0 within 1 s (clamped up to 300 ms). Repeat with duration 10,000 ms: it is still 1 after 1,500 ms and 0 after 2,600 ms (clamped down to 2,000 ms).

**E2E-19 @stage2 at most 150 particles (M6).** Post `entries(600)`. After 3 s, `stats()` reports `maxActiveParticles` ≤ 150, `particlesSpawned + particlesMerged` = 600 and `particlesMerged` ≥ 450.

### Stage 3 — Detail

**E2E-20 @stage3 an LLM call shows what was asked and answered (D1, D3, F3, U2, U3).** Play the demo. Click row a13. `detail-panel` is visible with `detail-name` `chat gpt-4o-mini`, `detail-kind` `llm`, `detail-service` `shop-api`, `detail-duration` `880 ms`, `detail-status` `OK`. `llm-provider` reads `openai`, `llm-model` `gpt-4o-mini`, `llm-input-tokens` `96`, `llm-output-tokens` `23`, `llm-finish-reason` `stop`. An `llm-message` with `data-role="system"` contains `You are a support agent for an online shop.` and one with `data-role="user"` contains `Where is my order 1042?`. `llm-response` contains `Order 1042 has shipped. 3 units of SKU-7 are in stock.` `llm-no-content` is hidden. The `attr-row` with `data-key="gen_ai.usage.input_tokens"` contains `96`. Edge `shop-api>openai` has `data-highlighted="true"` and the other 7 edges have `false`.

Click row a07. `llm-finish-reason` reads `tool_calls`. Two `llm-tool-call` elements exist, with `data-tool-name` `lookup_order` (containing `1042`) and `check_stock` (containing `SKU-7`).

**E2E-21 @stage3 the waterfall follows one request through every hop (D2, K7, U4).** Play the demo. Click row a10. `waterfall` holds exactly 14 `waterfall-row`s, ordered by start time, the first being a01 with `data-service="shop-browser"`. `data-depth` is 0 for a01, 1 for a02, 2 for a03, 3 for a04, 4 for a06, 5 for a09, 6 for a10. Rows exist for a14 (depth 4) and a08 (depth 6), which are not in the feed. Only a10 has `data-selected="true"`. Click the waterfall row for a05: `detail-name` reads `GET session:42`, `db-system` reads `redis`, and only a05 is selected.

**E2E-22 @stage3 HTTP and database detail (D4).** Play the demo. Click row b05: `db-system` reads `postgresql` and `db-statement` reads `INSERT INTO orders (id, sku, qty) VALUES ($1, $2, $3)`. Click row c01: `http-method` reads `GET`, `http-target` reads `http://localhost:3000/api/recommendations?user=42`, `http-status` reads `502`, `detail-status` reads `Error`. Click row a03: `http-method` reads `POST` and `http-status` reads `200`.

**E2E-23 @stage3 clear empties everything, even with detail open (reset contract).** Play the demo and click row a13. Call `POST /api/clear`. Within 1 s: `detail-panel` is hidden, no `feed-row` or `node` exists, `empty-state` is visible, `/healthz` reports `spans: 0`, and `stats()` reports 0 for `particlesSpawned`, `pulsesSpawned` and `maxActiveParticles`. Reload, play the demo again, click row a13: the panel shows `llm-model` `gpt-4o-mini` (detail is fetched from the process, not kept in the page).

### Stage 4 — Hookups

These need the mock LLM and both example apps running (1.1, 1.7).

**E2E-24 @stage4 a Node app shows up with no code changes (H1, H2, H4, H5, U7).** First, a static check: no file under `examples/node-app/src/` or `examples/python-app/app/` contains `opentelemetry` in any letter case, and `README.md` contains the four hookup lines from E2E-00. Then `GET http://127.0.0.1:4501/hello` returns 200 with `{"reply":"Hello from the mock model."}`. Within 5 s: nodes `Outside`, `node-example` (`service`) and `openai` (`llm`) exist; no node label contains `4599`; a row with `data-kind="http"`, name `GET /hello` and route `Outside → node-example` exists; a row with `data-kind="llm"` and route `node-example → openai` exists. Click the LLM row: `llm-model` reads `mock-model`, `llm-input-tokens` `12`, `llm-output-tokens` `6`, a user `llm-message` contains `say hello`, and `llm-response` contains `Hello from the mock model.`

**E2E-25 @stage4 one request across two real apps appears live, with its prompt (H2, H3, H4, U1, U2, U3, U4, U7).** **This is the most important test in the suite.** It proves the product's promise end to end: unmodified apps in two languages, a database and an LLM call, all on the map within seconds, with one click showing what was sent.

`GET http://127.0.0.1:4501/order/1042` returns 200 with `{"order":1042,"status":"shipped","summary":"Order 1042 has shipped."}`. Within 5 s of that response:

- Exactly 5 nodes exist: `Outside`, `node-example`, `python-example`, `sqlite` (`db`) and `openai` (`llm`).
- Exactly 4 edges exist: `Outside>node-example`, `node-example>python-example`, `python-example>sqlite`, `python-example>openai`.
- Exactly one row has the route `node-example → python-example`. No route contains `4502` or `4599`.
- A `db` row with route `python-example → sqlite` exists. Clicking it shows `db-system` `sqlite` and a `db-statement` containing `SELECT` and `orders`.
- An `llm` row with route `python-example → openai` exists. Clicking it shows `llm-model` `mock-model`, `llm-input-tokens` `18`, `llm-output-tokens` `5`, a user `llm-message` containing `order status`, and `llm-response` containing `Order 1042 has shipped.`
- With that row selected, the `waterfall` has rows with `data-service="node-example"` and rows with `data-service="python-example"`, and its first row (depth 0) is the `node-example` server span for `GET /order/:id`.

**E2E-26 @stage4 a failed LLM call from a real app shows as an error (U6, M5).** `GET http://127.0.0.1:4501/boom` returns 502 with `{"error":"llm_failed"}`. Within 5 s: an `llm` row with route `node-example → openai` has `data-status="error"`, and the `GET /boom` row has `data-status="error"`.

**E2E-27 @stage4 prompt text can arrive as log events (I7, D3).** Post `llm-bare` and click its row: `llm-model` reads `gpt-x`, `llm-input-tokens` reads `7`, and `llm-no-content` is visible and reads `Content not captured`. Close the panel. `postLogs` three records carrying that span's trace id and span id: event name `gen_ai.user.message` with body `{"content":"ping from logs"}`; event name `gen_ai.choice` with body `{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"pong from logs"}}`; and event name `app.started` with body `ignored`. The response is 200. Click the row again: a user `llm-message` contains `ping from logs`, `llm-response` contains `pong from logs`, and `llm-no-content` is hidden. `postMetrics({})` returns 200. `/healthz` still reports `spans: 1`.

### Stage 5 — Browser and polish

**E2E-28 @stage5 a browser page joins the trace (H6, I8, K9).** In a second tab open `http://127.0.0.1:4501/`, click `ask-button`, and wait for `ask-result` to read `Hello from the mock model.` In Livemap, within 5 s: node `browser-example` exists with `data-kind="browser"` and `data-column="0"`; edge `browser-example>node-example` exists; exactly one row has the route `browser-example → node-example`. Click the `llm` row: the `waterfall` has rows for both `browser-example` and `node-example`, and its first row has `data-service="browser-example"`.

Also: `OPTIONS /v1/traces` with `Origin: http://127.0.0.1:4501` returns 204 with `Access-Control-Allow-Origin: http://127.0.0.1:4501`. The same request with `Origin: https://evil.example` returns no `Access-Control-Allow-Origin` header.

**E2E-29 @stage5 other LLM conventions are recognised (K8).** Post `other-conventions`. Both rows have `data-kind="llm"`. Nodes `anthropic` and `openai` exist with `data-kind="llm"`. Click the `oi-svc` row: `llm-model` `claude-x`, `llm-input-tokens` `11`, `llm-output-tokens` `4`, a user message containing `hi from openinference`, `llm-response` containing `hello back`. Click the `ollm-svc` row: `llm-model` `gpt-y`, `llm-input-tokens` `9`, `llm-output-tokens` `2`, a user message containing `hi from openllmetry`, `llm-response` containing `hey there`.

**E2E-30 @stage5 nodes and edges carry counts (M8).** Play the demo. `node-count` reads: `shop-browser` 0, `shop-web` 3, `shop-api` 6, `shop-worker` 1, `redis` 1, `openai` 3, `postgresql` 4, `kafka` 1. (A node counts the drawn calls that arrive at it plus the pulses on it.) `edge-label` reads `3 · 38 ms` on `shop-api>postgresql` and `3 · 880 ms` on `shop-api>openai`. Every node has `data-idle="false"`.

**E2E-31 @stage5 filters (F4, M10, U10).** Play the demo (19 rows). Counts below are of visible `feed-row`s.

- Set `filter-kind` to `llm`: 3 rows, all `data-kind="llm"`. Set it back to `all`.
- Check `filter-errors`: 3 rows, c01, c03 and c05. Uncheck it.
- Type `ORDERS` into `filter-text`: 7 rows (a10, b01, b03, b05, b06, b07, b08). Empty it.
- Click node `postgresql`: `filter-chip` reads `postgresql`, and 4 rows remain (a10, a12, b05, b08). Click `filter-chip-clear`: 19 rows.
- Click edge `kafka>shop-worker`: 1 row, b07.

**E2E-32 @stage5 pause, resume and the clear button (F6, F7).** Click `pause-button`; it reads `Resume`. Play the demo. After 1 s there are 0 rows and 0 nodes, and `/healthz` reports `spans: 27`. Click it again; it reads `Pause`, and within 1 s there are 19 rows and 8 nodes. Click `clear-button`: 0 rows, `empty-state` visible, `/healthz` reports `spans: 0`.

**E2E-33 @stage5 scrolling back holds the feed still (F5).** Post `entries(60)`. Scroll `feed` down by 300 px. Record the first `feed-row`'s span id. Post `entries(3)` with fresh ids. `new-rows-pill` is visible and reads `3 new`. The first `feed-row` is unchanged. Click the pill: `feed` has `scrollTop` 0, the pill is hidden, and the first row is the newest of the three.

**E2E-34 @stage5 hide content masks everything sensitive and survives a reload (D6, U9).** Play the demo. Click row a13: `llm-response` contains `Order 1042`. Check `hide-content-toggle`. Every `llm-message` and `llm-response` reads `[hidden]`, and the `attr-row` for `gen_ai.input.messages` reads `[hidden]`. Click row b05: `db-statement` reads `[hidden]`. Click row c01: `http-target` reads `http://localhost:3000/api/recommendations?[hidden]`, and so does the `attr-row` for `url.full`. Reload: the toggle is still checked, and row a13's `llm-response` reads `[hidden]`. Uncheck it: `llm-response` contains `Order 1042` again.

**E2E-35 @stage5 a failed span shows its exception (D5).** Play the demo. Click row c03, then the waterfall row for c04: `error-type` reads `UpstreamTimeout`, `error-message` reads `recommendation model timed out`, and `error-stack` contains `at recommend (`. Click row c05: `error-type` reads `timeout`.

**E2E-36 @stage5 late spans join an open waterfall (D7).** Post spans 01 and 02 of `late-trace`. Click the row for `d700000000000002`: the waterfall has 2 rows. Post span 03. Within 1 s the waterfall has 3 rows, `detail-panel` is still visible, and `…02` is still the selected row.

**E2E-37 @stage5 reduced motion (M11).** In a context created with `reducedMotion: 'reduce'`, post `entry-http`. Its row appears. Edge `Outside>solo-api` has `data-flash="true"` within 500 ms and `data-flash="false"` 1 s later. `stats().particlesSpawned` stays 0.

**E2E-38 @stage5 sustained load (Throughput, M6, M9, Reliability).** Timeout 120 s. Post `entry-http`. Call `startDemo({ rate: 200, seed: 1 })`. For 60 s, read `stats()` once a second. Stop the demo. The median `fps` is at least 30. `maxActiveParticles` is at most 150. `connection-status` read `Live` at every sample. There are exactly 500 `feed-row`s. `/healthz` returns 200 with `spans: 5000`. Within 5 s of stopping, node `solo-api` has `data-idle="true"` (it has had no traffic for 60 s) while node `shop-api` has `data-idle="false"`.

**E2E-39 @stage5 the page reconnects by itself (Reliability).** `spawnLivemap(['--port','4490','--otlp-port','4491'])` and open `http://127.0.0.1:4490/`. Set `window.__marker = 1`. Kill the process: within 3 s `connection-status` reads `Reconnecting…`. Spawn it again with the same ports: within 5 s `connection-status` reads `Live`, and `window.__marker` is still 1.

**E2E-40 @stage5 `init` prints the right lines and touches nothing (X9).** In a temporary folder holding only `package.json`, run `LIVEMAP_BIN init`: exit code 0, stdout contains `--require @opentelemetry/auto-instrumentations-node/register` and the four hookup lines, and the folder's file list and contents are unchanged. In a folder holding only `requirements.txt`: stdout contains `opentelemetry-instrument`. In an empty folder: stdout contains `No Node or Python project found` and the four hookup lines.

**E2E-41 @stage5 keyboard and labels (Accessibility).** Play the demo. Focus the first `feed-row` with the keyboard and press Enter: `detail-panel` opens. Press Escape: it closes and focus returns to that row. Row a13's `row-kind` reads `LLM` and row a06's reads `Agent`.

`--open` (X8) is covered by a unit test with an injected opener, not by an E2E spec.

### Smoke — real model (manual only)

Skipped unless `RUN_SMOKE=1`, `MOCK_LLM=0`, and `LLM_API_KEY` and `LLM_MODEL` are set. The example apps are started with `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` from `.env` in place of the mock. Assertions stay loose because model output varies.

**SMOKE-1 @smoke Node app, real model.** `GET http://127.0.0.1:4501/hello` returns 200 within 30 s. An `llm` row from `node-example` appears. Its detail shows an `llm-model` containing the value of `LLM_MODEL`, an `llm-input-tokens` greater than 0, and a non-empty `llm-response`.

**SMOKE-2 @smoke Python app, real model.** `GET http://127.0.0.1:4501/order/1042` returns 200 within 30 s. An `llm` row from `python-example` appears with a non-empty `llm-response`, and its waterfall includes both services.

**SMOKE-3 @smoke hide content on a real reply.** With `hide-content-toggle` checked, the `llm-response` from SMOKE-1 reads `[hidden]`.

## 3. Playwright MCP walkthrough

After the specs pass for a stage, walk the same scenario IDs through the `playwright-headless` MCP server, which is a separate headless browser driven step by step:

1. Make sure Livemap is running (`npm start`), plus the mock LLM and both examples from stage 4 on (`npm run examples:start`). Call `POST /api/clear`.
2. For each scenario: navigate to `http://127.0.0.1:4400/`, take an accessibility snapshot, feed in the data from a shell (`npm run demo:once`, or `curl` a fixture written out by `npm run fixtures:dump`), and take a snapshot after each key step. Act through the `data-testid` selectors.
3. Check the same outcomes the spec asserts. Read particle and pulse counts by evaluating `window.__livemap.stats()`, and server state through `/healthz`, `/api/span/:id` and `/api/trace/:id`.
4. Record `E2E-xx: pass | fail — note` in `docs/VERIFICATION.md`.

Scenarios that only spawn processes (E2E-01, E2E-40) and the 60-second load test (E2E-38) are not walked; note them as `spec only`. For E2E-38, do a 10-second look instead: start `npm run demo -- --rate 200 --target http://127.0.0.1:4318`, snapshot, and record the `fps` you saw.

A scenario that passes in `@playwright/test` but fails in the MCP walkthrough (or the reverse) is a bug in either the spec or the app. Investigate and fix it. Don't mark it passed.
