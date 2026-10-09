// A small Express app. It knows nothing about tracing: the hookup is start flags and environment only.
const path = require('node:path');
const express = require('express');
const OpenAI = require('openai');

const PORT = Number(process.env.PORT || 4501);
const PYTHON_URL = process.env.PYTHON_APP_URL || 'http://127.0.0.1:4502';
const MODEL = process.env.LLM_MODEL || 'mock-model';

const llm = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'http://127.0.0.1:4599/v1',
  apiKey: process.env.LLM_API_KEY || 'mock-key',
  maxRetries: 0,
});

/** @param {string} prompt */
async function ask(prompt) {
  const completion = await llm.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? '';
}

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/hello', async (_req, res) => {
  res.json({ reply: await ask('Please say hello.') });
});

app.get('/order/:id', async (req, res) => {
  const upstream = await fetch(`${PYTHON_URL}/orders/${encodeURIComponent(req.params.id)}`);
  res.status(upstream.status).json(await upstream.json());
});

app.get('/boom', async (_req, res) => {
  try {
    res.json({ reply: await ask('Please fail.') });
  } catch {
    res.status(502).json({ error: 'llm_failed' });
  }
});

// The browser example page (built by `npm run examples:setup`).
app.use(express.static(path.join(__dirname, '..', '..', 'browser-page', 'dist')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`node-example listening on http://127.0.0.1:${PORT}`);
});
