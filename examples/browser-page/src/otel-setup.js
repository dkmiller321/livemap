// The browser hookup: the one setup file, bundled by esbuild into dist/otel.js and loaded before app.js.
// Fetch calls get a CLIENT span and send `traceparent` to the same origin, so the server spans they
// cause join the same trace. Spans go to Livemap's receiver as OTLP JSON.
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';

const RECEIVER = 'http://127.0.0.1:4318/v1/traces';

const provider = new WebTracerProvider({
  // Keep the default resource: it carries telemetry.sdk.language=webjs, which makes this a browser node.
  resource: defaultResource().merge(resourceFromAttributes({ 'service.name': 'browser-example' })),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: RECEIVER }), { scheduledDelayMillis: 200 })],
});
provider.register({ contextManager: new ZoneContextManager() });

registerInstrumentations({
  instrumentations: [new FetchInstrumentation({ ignoreUrls: [RECEIVER] })],
});
