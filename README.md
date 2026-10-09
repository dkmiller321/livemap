# Livemap

See your running app as a live map. Every HTTP call, database query, LLM call, agent step and queue
message lights up as it happens, and a click shows what was sent and what came back.

Livemap is one local process: an OpenTelemetry receiver on `127.0.0.1:4318` and a page on
`127.0.0.1:4400`. No account, no configuration file, nothing written to disk, nothing sent anywhere.

## Try it

```bash
npx livemap demo --open
```

The demo plays a small shop (browser, web, API, Postgres, Redis, an LLM, an agent with two tools,
a queue and a worker) through the real receiver, with about one call in ten failing.

## Hook up your app

Start Livemap:

```bash
npx livemap
```

Then start your app with these four environment variables. They work for any OpenTelemetry SDK:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_BSP_SCHEDULE_DELAY=200
```

Add `OTEL_SERVICE_NAME=<name>` to name your app on the map. `npx livemap init` looks at the current
folder and prints the exact lines for Node or Python. Full recipes, including LLM prompt capture:

- [Node](docs/hookups/node.md): `node --require @opentelemetry/auto-instrumentations-node/register src/app.js`
- [Python](docs/hookups/python.md): `opentelemetry-instrument uvicorn app.main:app`
- [Browser](docs/hookups/browser.md): fetch calls join the same trace as the server spans they cause

## What you see

- **Map**: browsers and Outside on the left, your services in the middle, databases, queues, LLM
  providers and external APIs on the right. One particle per call, coloured by kind; failures flash red.
- **Feed**: one row per call, newest first. Filter by kind, errors or name; pause; clear.
- **Detail**: click a row for the span's attributes, the whole trace as a waterfall, and for LLM calls
  the model, token counts, messages, response and tool calls. **Hide content** masks prompts,
  responses, SQL and query strings for screen sharing.

## Command line

```
livemap [--port 4400] [--otlp-port 4318] [--max-spans 5000] [--open]
livemap demo [--seed 1] [--rate 10] [--once] [--target http://127.0.0.1:4318]
livemap init
```

If a port is taken, Livemap exits with code 1 and names the flag that changes it. Port 4317
(OpenTelemetry gRPC) is never used.

## Developing

```bash
npm install
npm start                 # Livemap on :4400 / :4318
npm run demo:once         # play the fixed demo into a running Livemap
npm test                  # unit tests
npm run typecheck
npm run test:e2e          # Playwright specs (starts Livemap, and the examples once set up)
npm run examples:setup    # install the Node, Python and browser examples
npm run examples:start    # mock LLM :4599, node-example :4501, python-example :4502
```

The examples call a scripted mock LLM, so no API key is needed. See `docs/E2E_TESTS.md` for the
acceptance contract and `docs/VERIFICATION.md` for what has been run.

## Licence

MIT. Bundles the OpenTelemetry protocol definitions (Apache-2.0); see `NOTICE.md`.
