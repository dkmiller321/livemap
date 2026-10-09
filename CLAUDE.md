# CLAUDE.md — Livemap

Read these first, in order:

1. `docs/PRD.md`: what we are building and why. It is the source of truth for scope.
2. `docs/E2E_TESTS.md`: the acceptance contract. A feature exists when its scenarios pass.
3. This file: how to work.

If this file and the PRD disagree, the PRD wins. If the PRD and E2E_TESTS.md disagree, stop and ask.

## Stack (fixed)

| Layer | Choice |
|---|---|
| Runtime | Node 20 or newer, npm, ES modules (`.mjs`), plain JavaScript with JSDoc types. No build step for Livemap itself. |
| HTTP | `node:http` only. No web framework. |
| Protobuf | `protobufjs` (the one runtime dependency), with the OpenTelemetry trace and logs definitions bundled as `src/otlp/descriptor.json` |
| Live push | Server-sent events on `GET /events` |
| Page | `public/index.html` plus ES modules. No framework, no bundler. SVG for nodes and edges, one `<canvas>` for particles. |
| State | In-memory only. Nothing is written to disk. |
| Type check | `typescript` as a dev tool: `tsc --noEmit` with `checkJs` |
| Tests | `node:test` (unit), `@playwright/test` (E2E, specs in TypeScript) |
| Examples | Express, FastAPI, the `openai` SDKs, OpenTelemetry auto-instrumentation, esbuild for the browser example only |
| Delivery | One npm package named `livemap` with a `bin` entry, run through `npx` |

Pre-approved packages:

- **Livemap runtime:** `protobufjs`. Nothing else.
- **Livemap dev:** `@playwright/test`, `typescript`, `@types/node`, `protobufjs-cli` (to regenerate the descriptor).
- **`examples/node-app`:** `express`, `openai`, `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/instrumentation-openai`.
- **`examples/browser-page`:** `@opentelemetry/api`, `@opentelemetry/sdk-trace-web`, `@opentelemetry/resources`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation-fetch`, `@opentelemetry/context-zone`, `esbuild`.
- **`examples/python-app`:** `fastapi`, `uvicorn`, `openai`, `opentelemetry-distro`, `opentelemetry-exporter-otlp-proto-http`, `opentelemetry-instrumentation-openai-v2`, and whatever `opentelemetry-bootstrap -a install` adds.

**Ask before adding any other runtime dependency to Livemap.** Extra dev-only tooling and extra OpenTelemetry instrumentation packages inside `examples/` are fine; record them in `docs/DECISIONS.md`.

## Hard rules

- **Tests first.** Write every E2E spec in `docs/E2E_TESTS.md` before building features. Specs may fail; they may not be weakened later to pass. If a scenario is wrong, say so and propose the change. Never silently edit an assertion, loosen a count, lengthen a time limit, or add a skip.
- **Nothing is done until it has run.** For every claim of "works", state the command you ran and what you observed.
- **No real model in tests.** Only `@smoke` may reach a real LLM. Everything else uses the mock LLM server and the demo scenario exactly as specified in E2E_TESTS.md.
- **Test data goes through the front door.** Tests feed Livemap over HTTP through the real receiver. No test-only shortcuts into Livemap's memory, and no test-only branches in product code. `window.__livemap.stats()` and `POST /api/clear` are product features, always on.
- **Selectors and data attributes are a contract.** Use the `data-testid` values, `data-*` attributes, node ids and text formats in E2E_TESTS.md exactly. Don't rename them.
- **Localhost only.** Every listener binds `127.0.0.1`. Livemap makes no outbound network connection, writes no file and collects no telemetry. The demo and `--target` only ever post to a loopback address.
- **Never bind port 4317.** KitForge uses `127.0.0.1:4317` on this machine. OTLP over gRPC is P2 and out of scope.
- **No code from the reference projects.** Recreate their behaviour independently. agenttrail is MIT, so a short borrowed pattern is allowed with attribution in `NOTICE.md`, but the plan is ideas only. Phoenix has a non-standard licence: copy nothing from it. The bundled OpenTelemetry protocol definitions are Apache-2.0: keep their notice in `NOTICE.md`.
- **Respect the non-goals.** No persistence, replay, login, remote access, metrics dashboards, log search, evals, proxying or sniffing, architecture file, mobile layout, plugins or theming. No P2 items (I9, M12, D8, H7).
- **The hookup stays out of application code.** Example application source never mentions OpenTelemetry (E2E_TESTS.md 1.7). Start flags, environment variables and one separate setup file per example are the only places it may appear.
- **No TODOs or stubs** left in committed code. Implement it, or record it as out of scope in `docs/DECISIONS.md`.
- **Secrets stay out of the repo and out of the page.** `LLM_API_KEY` lives only in `.env` and is read only by the example apps and the smoke run.

## Conventions

Layout:

```
bin/livemap.mjs        CLI entry: parse arguments, call into src/, print, exit codes
src/cli/               args.mjs, init.mjs, open.mjs
src/otlp/              decode.mjs (JSON, protobuf, gzip), descriptor.json
src/core/              buffer.mjs, classify.mjs, pair.mjs, graph.mjs, llm-content.mjs, mask.mjs
src/server/            receiver.mjs (:4318), api.mjs (:4400), sse.mjs
src/demo/              scenario.mjs (the fixed --once spans), generator.mjs
public/                index.html, app.js, map.js, particles.js, feed.js, detail.js, styles.css
examples/              mock-llm/, node-app/, python-app/, browser-page/
e2e/                   *.spec.ts, helpers/, fixtures/
test/                  unit tests, one file per src/core module
docs/                  PRD.md, E2E_TESTS.md, VERIFICATION.md, DECISIONS.md, hookups/
```

- **`src/core/` is pure.** Its functions take spans and state and return new state or events. No I/O, no timers created inside them (time and timers are passed in), no globals. This is where kind rules, pairing, graph building, LLM content extraction and masking live, and each has unit tests that cover every row of the PRD's rule tables and every bullet of the pairing rules, including both arrival orders and the late-pairing correction.
- **Arguments are parsed once** in `src/cli/args.mjs`. Livemap reads no environment variables and no config file. `.env` is read only by `playwright.config.ts`, the npm example scripts and the example apps.
- **LLM content has one reader.** `src/core/llm-content.mjs` turns any supported shape into one normalised form (`provider`, `model`, token counts, `finishReason`, `messages`, `response`, `toolCalls`). It accepts, in order: current span attributes (`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`), span events and attached log events (`gen_ai.*.message`, `gen_ai.choice`), legacy indexed attributes (`gen_ai.prompt.N.*`, `gen_ai.completion.N.*`), then OpenInference (`llm.*`). The detail panel only ever sees the normalised form.
- **Log event names** may arrive as the log record's `eventName` field or as an `event.name` attribute. Accept both.
- **Masking is done in the page**, by one function used for every place content is shown, so the Hide content switch cannot miss a field.
- **Errors:** the receiver answers 400 for anything it cannot decode and logs one line to stderr. Nothing else is caught and swallowed. No retry wrappers, no blanket try/catch.
- **npm scripts** (these names are used by E2E_TESTS.md): `start`, `demo`, `demo:once`, `test`, `typecheck`, `test:e2e`, `examples:setup`, `examples:start`, `example:node`, `example:python`, `fixtures:dump`.
- Commit after each stage with the message `stage N: <summary>`.

## Hookup recipes: what to verify, not assume

The four base lines are fixed (E2E-00). The LLM capture settings change between instrumentation releases, so check them against the README of the version you actually install and record what you found in `docs/DECISIONS.md`.

- **Python** (checked October 2026 against the OpenTelemetry Python contrib docs): `pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http opentelemetry-instrumentation-openai-v2`, then `opentelemetry-bootstrap -a install`, then start with `opentelemetry-instrument uvicorn app.main:app --port 4502`. Content capture needs `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only`. Without the opt-in, content is sent as log events; set `OTEL_LOGS_EXPORTER=otlp` too, so either path reaches Livemap.
- **Node** (not verified): `node --require @opentelemetry/auto-instrumentations-node/register src/app.js`. Check whether your version of `@opentelemetry/auto-instrumentations-node` already includes `@opentelemetry/instrumentation-openai`. If it does not, register it in one separate setup file loaded with `--import`. Find its content-capture setting in its README.
- **Both:** the OpenAI SDK's own HTTP request must show up as a child of the LLM span, so Livemap's "same call seen twice" rule hides it. If E2E-24 shows a node containing `4599`, that parent link is missing; fix the hookup, not the rule.
- Write the final, working recipes to `docs/hookups/node.md`, `docs/hookups/python.md` and `docs/hookups/browser.md`, and put the four base lines in `README.md`.

## Workflow

Work through the stages in `docs/PRD.md` → Milestones, in order, without waiting for confirmation between stages unless you are blocked.

For each stage:

1. Implement the stage.
2. Run `npm run typecheck && npm test`.
3. Run `npm run test:e2e -- --grep "@stage0|…|@stageN"`. All scenarios tagged for this stage **and every earlier stage** must pass.
4. **Verify with the `playwright-headless` MCP server.** Start Livemap, then walk each of this stage's scenarios through the MCP tools, following section 3 of E2E_TESTS.md. This is a second, independent check that the page behaves as the specs claim.
5. Append a section to `docs/VERIFICATION.md`: the stage, the commands run with their pass/fail counts, each MCP-walked scenario ID with its result, and anything that surprised you.
6. Add a line to `KIT_FEEDBACK.md` for anything in this kit that was missing, wrong, ambiguous or unusually helpful during the stage.
7. Commit.

Stop and ask when:

- a change would alter the PRD's scope or a test's assertion,
- a dependency outside the approved list seems necessary for Livemap itself,
- the same failure survives three genuine fix attempts,
- Python 3.10+ or the `playwright-headless` MCP server is not available.

## Final acceptance

1. **Pack and install.** `npm pack`. In a fresh temporary folder, `npm init -y && npm install <path to the .tgz>`. Start it from there with `npx livemap`, and wait for `http://127.0.0.1:4400/healthz` to return 200. This proves the published form carries the page and the descriptor.
2. Start the mock LLM and both examples with `npm run examples:start`.
3. Run `BASE_URL=http://127.0.0.1:4400 OTLP_URL=http://127.0.0.1:4318 LIVEMAP_BIN="<temp folder>/node_modules/.bin/livemap" npm run test:e2e`. All non-smoke tests must pass.
4. Walk every P0 scenario (E2E-00 and E2E-02 to E2E-27) through the `playwright-headless` MCP server against the packed install.
5. If `LLM_API_KEY` is set, run `RUN_SMOKE=1 npm run test:e2e -- --grep @smoke`.
6. Check the Security row of the PRD: search `src/`, `bin/` and `public/` for outbound network calls and file writes, and state what you found.
7. Write the final summary in `docs/VERIFICATION.md`: totals, any skipped tests with reasons, known issues, and the exact commands to run Livemap, the demo and the examples.
8. **Send the kit feedback to KitForge.** Run this once, filled in from what actually happened. Each log line in `KIT_FEEDBACK.md` becomes one `corrections` entry (`text` = the line with its tag; `quote` = the user's own words if the line records something the user corrected, otherwise an empty string).

```bash
curl -s -X POST http://127.0.0.1:4317/api/runs/report -H "content-type: application/json" -d @- <<'JSON'
{
  "kit": "idea-to-build-kit",
  "version": "1.1.0",
  "project_path": "<absolute path of this repo>",
  "outcome": "<success | partial | failed>",
  "corrections": [
    { "text": "<[tag] what happened, in general terms>", "quote": "<the user's own words, under 300 characters, or empty>" }
  ],
  "tests": { "passed": 0, "failed": 0 }
}
JSON
```

   `outcome` is `success` if every non-smoke spec passed with no assertion changed, `partial` if it passed with approved spec changes or known issues, `failed` otherwise. `tests` holds the final E2E pass and fail counts. If the command fails because KitForge is not running, say so in one line in `docs/VERIFICATION.md` and stop. Do not retry.
