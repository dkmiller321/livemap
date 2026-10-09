# KIT_FEEDBACK.md

Kit: `idea-to-build-kit` v1.1.0 · Project: Livemap

This file is feedback on the kit itself (the PRD, the tests, CLAUDE.md and the kickoff prompt), not on the product. Claude Code adds a line whenever something in the kit was missing, wrong, ambiguous or unusually helpful. At final acceptance the log is sent to KitForge (CLAUDE.md → Final acceptance, step 8), which is how the next kit gets better. Be honest and specific; an empty log after a full build is not believable.

## Tags

| Tag | Use it when |
|---|---|
| `[spec-gap]` | The PRD or the tests did not say something you needed, and you had to decide |
| `[spec-wrong]` | The PRD and the tests contradicted each other, or an assertion could not be true |
| `[dep]` | A package or tool behaved differently from what the kit claimed |
| `[env]` | The machine, ports, MCP server or tooling got in the way |
| `[flaky]` | A scenario passed and failed without a code change |
| `[user]` | The user corrected or redirected you; include their words |
| `[good]` | Something in the kit saved real time or prevented a mistake |

## Format

`- stage N [tag] what happened → what you did`

## Log

- stage 0 [env] `python3` on this Windows machine is 3.8 while `python` is 3.13, and `.env.example` defaults `PYTHON_BIN=python3` → the setup script now probes `PYTHON_BIN`, `python3`, `python` and `py -3` for 3.10+.
- stage 0 [env] A refused TCP connect takes about 2 s on Windows, so E2E-01's "connecting is refused" check needs a connect timeout above 2 s → raised the helper's socket timeout, left the assertion alone.
- stage 0 [dep] `protobufjs-cli` 2.7 requires `protobufjs` 8 as a peer, so the kit's implied 7.x install fails with ERESOLVE → used protobufjs 8.8.
- stage 0 [spec-gap] E2E_TESTS.md 1.3 does not say what kind `span()` defaults to, and the `kinds` fixture rows (02, 03, 08, 09, 0a) give no OpenTelemetry kind → default INTERNAL, client-call rows built as CLIENT; recorded in DECISIONS.md.
- stage 0 [spec-gap] The PRD lists six event-stream event types, but rolling counts (M8) and live waterfall updates (D7) need more → added `counts` and `trace` events; recorded in DECISIONS.md.
- stage 0 [good] The data-testid and data-attribute contract plus `window.__livemap.stats()` meant every spec could be written before any page existed, with no guessing about selectors.
- stage 1 [good] The demo table in E2E_TESTS.md 1.5 with exact ids, offsets, durations and totals made the scenario a direct transcription, and its totals line doubled as a unit test.
- stage 1 [spec-gap] E2E-07 asks to "collect every row" after the demo but gives no point at which rows are complete (client spans to unknown hosts wait up to 300 ms) → the spec waits 1 s after the demo exits before collecting.
- stage 2 [good] Reading particle counts through `window.__livemap.stats()` instead of pixels made M4 and M6 testable to the millisecond (E2E-18 measured 792 / 302 / 1,999 ms travel).
- stage 2 [spec-gap] M6 says to merge "spans on the same edge within 100 ms" but not what to do at the cap when no particle shares the edge → the oldest particle ends early; recorded in DECISIONS.md.
- stage 2 [env] Driving the MCP browser and a shell in turns adds seconds between steps, so time-based checks (E2E-16, E2E-18) had to be sampled inside the page with a timer and read back afterwards.
- stage 3 [spec-gap] E2E-34 asserts that an `llm-message` and an `attr-row` "read `[hidden]`", which only works if the role and the attribute key are not part of the element's text, and the selector contract does not say so → the role and key are drawn with CSS `::before` from `data-role` / `data-key`, so the elements' text is exactly the (masked) value.
- stage 3 [good] Writing the waterfall depths for every hop (E2E-21) into the spec caught nothing wrong, but made the trace view's ordering and depth rules unambiguous before any code existed.
- stage 4 [dep] The kit's Python recipe was right, but a fresh `pip install` pulled `openai` 3.x (now on `httpx2`) and `opentelemetry-util-genai` 1.2b0 (module renamed), and each made `opentelemetry-instrumentation-openai-v2` 2.4b0 skip itself silently → pinned `openai<3` and `opentelemetry-util-genai<1.2`, found via the loader's DEBUG log.
- stage 4 [dep] The Node recipe said to check whether auto-instrumentations-node includes the OpenAI instrumentation: 0.81.0 does, so no setup file was needed.
- stage 4 [env] `opentelemetry-instrument` uses `os.execl`, which on Windows detaches the app and exits, so the Playwright webServer and Ctrl-C lose it → on Windows the script reproduces the launcher with PYTHONPATH.
- stage 4 [spec-gap] The sqlite3 instrumentation ignores `Connection.execute()`, the most common way to query SQLite in a small app; the kit's E2E-25 needs a `db` row → the example uses a cursor, and the limitation is in the Python recipe.
- stage 4 [good] CLAUDE.md's warning that a node containing `4599` means a broken parent link pointed straight at the problem when the first run showed `127.0.0.1:4599` (the LLM span was missing, so its HTTP child had no LLM parent).
- stage 4 [env] Node's default resource detectors probe cloud metadata and added ~10 s to the example's start-up → `OTEL_NODE_RESOURCE_DETECTORS` limited to local detectors.
- stage 5 [spec-gap] The pairing rules say what happens when a server span's 300 ms wait runs out, but not when its client arrives afterwards. With the browser hookup that is the normal case (fetch spans end ~300 ms late), and E2E-28 alone would not have caught the duplicate `Outside →` row → added a correction that takes the server's row back, mirroring the PRD's late-pairing rule.
- stage 5 [dep] `@opentelemetry/sdk-trace-web` 2.x replaces, rather than merges, the default resource when `resource` is passed, which silently drops `telemetry.sdk.language=webjs` that K9 relies on → merged with `defaultResource()`.
- stage 5 [good] E2E-38's 60-second load spec with fps, particle cap, row cap and idle checks in one test gave real confidence in the throughput target; it passed first time.
- stage 5 [spec-gap] E2E-41 says "focus the first feed-row with the keyboard" without saying from where; the spec tabs from the top of the page, the MCP walk tabbed from the name filter.
- stage 0 [env] On Windows, `LIVEMAP_BIN` pointing at `node_modules/.bin/livemap` is a `.cmd` shim that Node cannot spawn without a shell, and a shell would eat SIGINT → the helper runs the installed package's `bin/livemap.mjs` with Node directly.

