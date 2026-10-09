# Browser hookup

Tested with `examples/browser-page` in Chromium, against `@opentelemetry/sdk-trace-web` 2.12.0,
`@opentelemetry/instrumentation-fetch` 0.223.0, `@opentelemetry/exporter-trace-otlp-http` 0.223.0
and `@opentelemetry/context-zone` 2.12.0, bundled with esbuild 0.28. The page's own script does
not change; the setup is one separate file loaded before it.

## 1. Install

```bash
npm install --save-dev @opentelemetry/api @opentelemetry/sdk-trace-web @opentelemetry/resources \
  @opentelemetry/exporter-trace-otlp-http @opentelemetry/instrumentation @opentelemetry/instrumentation-fetch \
  @opentelemetry/context-zone esbuild
```

## 2. One setup file

```js
// otel-setup.js
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';

const RECEIVER = 'http://127.0.0.1:4318/v1/traces';

const provider = new WebTracerProvider({
  resource: defaultResource().merge(resourceFromAttributes({ 'service.name': 'my-page' })),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: RECEIVER }), { scheduledDelayMillis: 200 })],
});
provider.register({ contextManager: new ZoneContextManager() });
registerInstrumentations({ instrumentations: [new FetchInstrumentation({ ignoreUrls: [RECEIVER] })] });
```

Bundle it and load it before your own script:

```bash
npx esbuild otel-setup.js --bundle --format=iife --minify --outfile=dist/otel.js
```

```html
<script src="/otel.js"></script>
<script src="/app.js"></script>
```

## Notes

- **Keep the default resource.** Passing only `resourceFromAttributes(...)` replaces it and drops
  `telemetry.sdk.language=webjs`, so the page shows up as a service instead of a browser node.
- **Same-origin fetches** carry `traceparent` automatically, so the server spans they cause join the
  page's trace. For other origins, add them to `propagateTraceHeaderCorsUrls` and allow the
  `traceparent` header in the server's CORS settings.
- **Livemap accepts cross-origin posts** to `/v1/traces` from `http://localhost:*` and
  `http://127.0.0.1:*` pages only.
- **Fetch spans arrive late.** The fetch instrumentation waits about 300 ms for resource timing
  before it ends a span, so a page's span can reach Livemap after the server's. Livemap first draws
  the server span from Outside, then replaces it with the browser's call when that arrives.
