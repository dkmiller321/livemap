// `livemap init`: detects Node or Python in a folder and prints the matching hookup. Changes no files.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hookupLines } from './args.mjs';

/**
 * @param {string} dir
 * @param {number} otlpPort
 * @returns {string}
 */
export function initText(dir, otlpPort) {
  const lines = hookupLines(otlpPort);
  const env = lines.map((l) => `  ${l}`).join('\n');
  const isNode = existsSync(join(dir, 'package.json'));
  const isPython = ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'].some((f) => existsSync(join(dir, f)));
  /** @type {string[]} */
  const out = [];
  if (isNode) {
    out.push(
      'Node project found.',
      '',
      '1. Install the auto-instrumentation (dev dependency is fine):',
      '  npm install --save-dev @opentelemetry/api @opentelemetry/auto-instrumentations-node',
      '',
      '2. Start your app with these environment variables and one extra flag:',
      env,
      '  OTEL_SERVICE_NAME=<your app name>',
      '  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true',
      '  node --require @opentelemetry/auto-instrumentations-node/register <your entry file>',
      '',
      'See docs/hookups/node.md in the livemap package for LLM prompt capture.',
    );
  }
  if (isPython) {
    if (out.length) out.push('');
    out.push(
      'Python project found.',
      '',
      '1. Install the OpenTelemetry distro and exporter, then the instrumentations for your libraries:',
      '  pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http opentelemetry-instrumentation-openai-v2',
      '  opentelemetry-bootstrap -a install',
      '',
      '2. Start your app through the launcher with these environment variables:',
      env,
      '  OTEL_SERVICE_NAME=<your app name>',
      '  OTEL_LOGS_EXPORTER=otlp',
      '  OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental',
      '  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only',
      '  opentelemetry-instrument <your usual start command>',
    );
  }
  if (!isNode && !isPython) {
    out.push(
      'No Node or Python project found in this folder.',
      '',
      'Any OpenTelemetry SDK reports to Livemap with these environment variables:',
      env,
    );
  }
  return out.join('\n');
}
