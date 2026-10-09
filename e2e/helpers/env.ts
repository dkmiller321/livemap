// Reads .env (if present) once, without a dependency. Process environment wins over the file.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readDotEnv(): Record<string, string> {
  const file = resolve('.env');
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const file = readDotEnv();
const get = (key: string, fallback = '') => {
  const v = process.env[key] ?? file[key];
  return v === undefined || v === '' ? fallback : v;
};

const livemapPort = get('LIVEMAP_PORT', '4400');
const otlpPort = get('LIVEMAP_OTLP_PORT', '4318');

export const env = {
  LIVEMAP_PORT: livemapPort,
  LIVEMAP_OTLP_PORT: otlpPort,
  BASE_URL: get('BASE_URL', `http://127.0.0.1:${livemapPort}`).replace(/\/$/, ''),
  OTLP_URL: get('OTLP_URL', `http://127.0.0.1:${otlpPort}`).replace(/\/$/, ''),
  EXTERNAL_LIVEMAP: get('BASE_URL') !== '',
  LIVEMAP_BIN: get('LIVEMAP_BIN'),
  MOCK_LLM_PORT: get('MOCK_LLM_PORT', '4599'),
  NODE_EXAMPLE_PORT: get('NODE_EXAMPLE_PORT', '4501'),
  PYTHON_EXAMPLE_PORT: get('PYTHON_EXAMPLE_PORT', '4502'),
  MOCK_LLM: get('MOCK_LLM', '1'),
  LLM_MODEL: get('LLM_MODEL'),
  LLM_API_KEY: get('LLM_API_KEY'),
  RUN_SMOKE: get('RUN_SMOKE', '0'),
};
