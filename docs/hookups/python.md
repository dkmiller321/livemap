# Python hookup

Tested with `examples/python-app` (FastAPI 0.143, uvicorn 0.54, `openai` 2.54, SQLite) on Python 3.13,
against `opentelemetry-distro` 0.66b1, `opentelemetry-exporter-otlp-proto-http` 1.45.1,
`opentelemetry-instrumentation-openai-v2` 2.4b0 and `opentelemetry-util-genai` 1.1b0.
No application source changes.

## 1. Install

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http opentelemetry-instrumentation-openai-v2
opentelemetry-bootstrap -a install
```

`opentelemetry-bootstrap` adds the instrumentations for the libraries it finds (FastAPI, httpx,
sqlite3 and so on).

## 2. Start through the launcher

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_BSP_SCHEDULE_DELAY=200
OTEL_SERVICE_NAME=my-app
opentelemetry-instrument uvicorn app.main:app --port 4502
```

## 3. LLM prompts and responses (optional)

```bash
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only
OTEL_LOGS_EXPORTER=otlp
```

With the opt-in, prompts and responses go on the LLM span as `gen_ai.input.messages` and
`gen_ai.output.messages`. Without it, content is sent as log events, which `OTEL_LOGS_EXPORTER=otlp`
also delivers to Livemap. Both paths show the same detail panel. (Checked against the README of
`opentelemetry-instrumentation-openai-v2` 2.4b0.)

## Version pitfalls found while testing (October 2026)

- **`openai` 3.x** moved its HTTP layer to `httpx2`. `opentelemetry-instrumentation-openai-v2` 2.4b0
  still imports `httpx` and silently skips itself, so no LLM span appears. Pin `openai<3` until the
  instrumentation catches up.
- **`opentelemetry-util-genai` 1.2b0** renamed `opentelemetry.util.genai.instruments`, which
  openai-v2 2.4b0 imports; the instrumentation skips itself again. Pin `opentelemetry-util-genai<1.2`.
- To see why an instrumentation was skipped, run Python with `logging` at DEBUG: the loader logs
  `Skipping instrumentation openai: …`.
- The **sqlite3** instrumentation traces cursor calls (`conn.cursor().execute(...)`). The
  `Connection.execute(...)` shortcut runs in C and is not traced.

## Windows

`opentelemetry-instrument` ends with `os.execl`. On Windows that starts your app as a new process and
exits immediately, so a process manager (or Ctrl-C in a script) loses track of it. The launcher only
does two things, so do them directly instead:

```powershell
$env:PYTHONPATH = "$PWD\.venv\Lib\site-packages\opentelemetry\instrumentation\auto_instrumentation;$PWD"
.venv\Scripts\uvicorn app.main:app --port 4502
```

`npm run example:python` does this on Windows and uses `opentelemetry-instrument` elsewhere.
