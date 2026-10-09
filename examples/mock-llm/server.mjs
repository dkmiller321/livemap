// A scripted, OpenAI-compatible chat server for the examples (E2E_TESTS.md 1.7). No dependencies.
// It answers from the last user message, so the examples run with no API key and no network.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_LLM_PORT || 4599);

/** First script whose trigger the last user message contains (lower-cased). */
const SCRIPTS = [
  { trigger: 'say hello', reply: 'Hello from the mock model.', prompt: 12, completion: 6 },
  { trigger: 'order status', reply: 'Order 1042 has shipped.', prompt: 18, completion: 5 },
  { trigger: 'fail', fail: true },
];
const DEFAULT = { reply: 'Mock: no script for this prompt.', prompt: 5, completion: 7 };

let counter = 0;

/** @param {any} content a message's content: a string or a list of parts */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join(' ');
  return '';
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && path === '/healthz') return json(res, 200, { status: 'ok' });
  if (req.method !== 'POST' || !/^(\/v1)?\/chat\/completions$/.test(path)) return json(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } });

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return json(res, 400, { error: { message: 'body is not JSON', type: 'invalid_request_error' } });
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
    const text = textOf(lastUser?.content).toLowerCase();
    const script = SCRIPTS.find((s) => text.includes(s.trigger)) ?? DEFAULT;
    if (script.fail) return json(res, 500, { error: { message: 'mock failure', type: 'server_error' } });
    counter++;
    json(res, 200, {
      id: `chatcmpl-mock-${counter}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: script.reply }, finish_reason: 'stop', logprobs: null }],
      usage: { prompt_tokens: script.prompt, completion_tokens: script.completion, total_tokens: script.prompt + script.completion },
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Mock LLM listening on http://127.0.0.1:${PORT}/v1\n`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
