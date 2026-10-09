# KICKOFF.md — paste the prompt below into Claude Code

Before you start:

1. Put these files in an empty repo: `CLAUDE.md`, `KICKOFF.md`, `KIT_FEEDBACK.md`, `.env.example` and `docs/`. Run `git init`.
2. `cp .env.example .env`. Nothing needs filling in unless you want the real-model smoke suite.
3. Check `node --version` is 20 or newer and `python3 --version` is 3.10 or newer.
4. Start Claude Code in the repo root and run `/mcp` to confirm the `playwright-headless` server is connected.

---

```
You are building Livemap from an empty repo.

Read, in order: docs/PRD.md, docs/E2E_TESTS.md, CLAUDE.md. Follow CLAUDE.md's rules
for the whole build.

Phase 1: Plan (then continue without waiting)
- Summarise the build in under 20 lines: the stages, how the demo scenario and the
  mock LLM make tests repeatable, and how you will verify each stage with both
  @playwright/test and the `playwright-headless` MCP server.
- List any contradictions or gaps you found in the docs. If any block you, stop and
  ask. Otherwise record your assumptions in docs/DECISIONS.md and continue.

Phase 2: Tests first (stage 0)
- Scaffold stage 0: package.json with the `livemap` bin and the npm scripts named in
  CLAUDE.md, argument parsing, both listeners on 127.0.0.1, /healthz, /api/clear,
  /events, the empty page with the hookup lines, window.__livemap.stats(), the
  node:test setup, and playwright.config.ts as described in E2E_TESTS.md 1.1.
- Write the helpers and fixtures from E2E_TESTS.md 1.3 and 1.6.
- Write EVERY scenario in docs/E2E_TESTS.md as a spec in e2e/, tagged by stage,
  plus the @smoke specs. Use the data-testid and data-attribute contract exactly.
- Run `npm run test:e2e -- --list` to prove they all compile, then run the suite.
  E2E-00 and E2E-01 must pass; everything else is expected to fail at this point.
- Confirm the `playwright-headless` MCP server works: navigate to the running page
  and take a snapshot. Record the result in docs/VERIFICATION.md. Commit.

Phase 3: Build stages 1–5
- For each stage, follow the Workflow in CLAUDE.md: implement, typecheck and unit
  tests, that stage's and all earlier stages' E2E specs green, then a
  `playwright-headless` MCP walkthrough of that stage's scenarios, then
  VERIFICATION.md, then KIT_FEEDBACK.md, then commit.
- Stage 1 includes src/demo/scenario.mjs: build it straight from the table in
  E2E_TESTS.md 1.5, and unit-test its totals (27 spans, 19 rows, 8 nodes, 8 edges).
- Stage 4 starts with `npm run examples:setup`. Verify the hookup recipes against
  the packages you actually install, as CLAUDE.md describes.
- Never weaken an assertion to make it pass. Propose spec changes instead.

Phase 4: Final acceptance
- Run the Final acceptance steps in CLAUDE.md against the packed install,
  including the KitForge report.
- Finish with a short report: pass/fail totals, anything skipped and why, known
  issues, and the exact commands I need to run Livemap, the demo and the examples
  myself.
```

---

## Useful follow-up prompts

- **Resume after a break:** `Read CLAUDE.md and docs/VERIFICATION.md, find the last completed stage, and continue from the next one.`
- **Re-verify:** `Clear Livemap and walk E2E-10 and E2E-25 through the playwright-headless MCP server; report each step.`
- **Real model:** `I have set LLM_API_KEY and LLM_MODEL in .env. Run RUN_SMOKE=1 npm run test:e2e -- --grep @smoke and report results.`
- **Try it on my own app:** `Run livemap init in <path to my project>, apply the lines it prints to that project's start script only, start both, and tell me what shows up on the map.`
