# Node hookup

Tested with `examples/node-app` (Express 5, `openai` 5.23) on Node 22, against
`@opentelemetry/auto-instrumentations-node` 0.81.0, which already bundles
`@opentelemetry/instrumentation-openai` 0.21.0 (it instruments `openai` `>=4.19.0 <7`).
No setup file is needed, and no application source changes.

## 1. Install

```bash
npm install --save-dev @opentelemetry/api @opentelemetry/auto-instrumentations-node
```

## 2. Start with these environment variables and one flag

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_BSP_SCHEDULE_DELAY=200
OTEL_SERVICE_NAME=my-app
node --require @opentelemetry/auto-instrumentations-node/register src/app.js
```

The first four lines are the same for every language. `OTEL_SERVICE_NAME` names the node on the map.

## 3. LLM prompts and responses (optional)

The OpenAI instrumentation records prompts and responses as **log events**, and only when asked:

```bash
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
OTEL_LOGS_EXPORTER=otlp
OTEL_BLRP_SCHEDULE_DELAY=200
```

Without these, the LLM call still appears with its model and token counts, and the detail panel says
`Content not captured`.

## Notes

- The SDK's HTTP request to the model is recorded as a child of the LLM span, so Livemap hides it
  (one call, one particle). If the map shows a node like `127.0.0.1:4599` or `api.openai.com`, that
  parent link is missing.
- `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,process,serviceinstance` skips the cloud metadata probes
  that otherwise add several seconds to start-up on a laptop. The example scripts set it.
- Windows PowerShell: set each variable with `$env:NAME = "value"` before the `node` command.
