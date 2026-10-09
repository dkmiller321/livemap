import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLlm } from '../src/core/llm-content.mjs';
import { TRACES } from '../src/demo/scenario.mjs';

/** @param {Record<string, any>} attributes @param {any[]} [events] @param {any[]} [logs] */
const span = (attributes, events = [], logs = []) => ({ attributes, events, logs });
const demo = (/** @type {string} */ id) => {
  const s = [...TRACES.A, ...TRACES.C].find((x) => x.id === id);
  assert.ok(s);
  return span(s.attributes);
};

test('current attributes: system instructions, messages, response, tokens (demo a13)', () => {
  const n = normalizeLlm(demo('a13'));
  assert.equal(n.provider, 'openai');
  assert.equal(n.model, 'gpt-4o-mini');
  assert.equal(n.inputTokens, 96);
  assert.equal(n.outputTokens, 23);
  assert.equal(n.finishReason, 'stop');
  assert.deepEqual(n.messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'tool']);
  assert.equal(n.messages[0].content, 'You are a support agent for an online shop.');
  assert.equal(n.messages[1].content, 'Where is my order 1042?');
  assert.deepEqual(n.messages[2].toolCalls.map((c) => c.name), ['lookup_order', 'check_stock']);
  assert.equal(n.messages[3].content, '{"status":"shipped"}');
  assert.equal(n.response, 'Order 1042 has shipped. 3 units of SKU-7 are in stock.');
  assert.equal(n.captured, true);
});

test('tool calls in the output (demo a07)', () => {
  const n = normalizeLlm(demo('a07'));
  assert.equal(n.finishReason, 'tool_calls');
  assert.equal(n.response, null);
  assert.deepEqual(n.toolCalls, [
    { id: 'call_1', name: 'lookup_order', arguments: '{"order_id":1042}' },
    { id: 'call_2', name: 'check_stock', arguments: '{"sku":"SKU-7"}' },
  ]);
});

test('input only (demo c05)', () => {
  const n = normalizeLlm(demo('c05'));
  assert.deepEqual(n.messages.map((m) => [m.role, m.content]), [['user', 'Recommend three products for user 42.']]);
  assert.equal(n.response, null);
  assert.equal(n.captured, true);
});

test('no content: captured is false', () => {
  const n = normalizeLlm(span({ 'gen_ai.provider.name': 'openai', 'gen_ai.request.model': 'gpt-x', 'gen_ai.usage.input_tokens': 7, 'gen_ai.usage.output_tokens': 3 }));
  assert.equal(n.model, 'gpt-x');
  assert.equal(n.inputTokens, 7);
  assert.equal(n.captured, false);
  assert.deepEqual([n.messages, n.response, n.toolCalls], [[], null, []]);
});

test('attached log events: gen_ai.user.message and gen_ai.choice', () => {
  const n = normalizeLlm(
    span({}, [], [
      { eventName: 'gen_ai.system.message', body: { content: 'be brief' }, attributes: {} },
      { eventName: 'gen_ai.user.message', body: { content: 'ping from logs' }, attributes: {} },
      { eventName: 'gen_ai.choice', body: { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'pong from logs' } }, attributes: {} },
    ]),
  );
  assert.deepEqual(n.messages.map((m) => [m.role, m.content]), [['system', 'be brief'], ['user', 'ping from logs']]);
  assert.equal(n.response, 'pong from logs');
  assert.equal(n.finishReason, 'stop');
});

test('log bodies as JSON strings, and assistant tool calls in OpenAI shape', () => {
  const n = normalizeLlm(
    span({}, [], [
      { eventName: 'gen_ai.choice', body: JSON.stringify({ message: { tool_calls: [{ id: 't1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] } }), attributes: {} },
    ]),
  );
  assert.deepEqual(n.toolCalls, [{ id: 't1', name: 'f', arguments: '{"a":1}' }]);
});

test('span events with gen_ai.event.content, and the older gen_ai.content.prompt / completion', () => {
  const a = normalizeLlm(span({}, [{ name: 'gen_ai.user.message', attributes: { 'gen_ai.event.content': '{"content":"from event"}' } }]));
  assert.equal(a.messages[0].content, 'from event');
  const b = normalizeLlm(
    span({}, [
      { name: 'gen_ai.content.prompt', attributes: { 'gen_ai.prompt': '[{"role":"user","content":"old prompt"}]' } },
      { name: 'gen_ai.content.completion', attributes: { 'gen_ai.completion': '[{"role":"assistant","content":"old answer"}]' } },
    ]),
  );
  assert.equal(b.messages[0].content, 'old prompt');
  assert.equal(b.response, 'old answer');
});

test('legacy indexed attributes (OpenLLMetry)', () => {
  const n = normalizeLlm(
    span({
      'gen_ai.system': 'openai',
      'gen_ai.request.model': 'gpt-y',
      'gen_ai.usage.prompt_tokens': 9,
      'gen_ai.usage.completion_tokens': 2,
      'gen_ai.prompt.0.role': 'system',
      'gen_ai.prompt.0.content': 'sys',
      'gen_ai.prompt.1.role': 'user',
      'gen_ai.prompt.1.content': 'hi from openllmetry',
      'gen_ai.completion.0.role': 'assistant',
      'gen_ai.completion.0.content': 'hey there',
      'gen_ai.completion.0.finish_reason': 'stop',
      'gen_ai.completion.0.tool_calls.0.name': 'lookup',
      'gen_ai.completion.0.tool_calls.0.arguments': '{"x":1}',
    }),
  );
  assert.equal(n.provider, 'openai');
  assert.deepEqual([n.inputTokens, n.outputTokens], [9, 2]);
  assert.deepEqual(n.messages.map((m) => m.content), ['sys', 'hi from openllmetry']);
  assert.equal(n.response, 'hey there');
  assert.equal(n.finishReason, 'stop');
  assert.deepEqual(n.toolCalls.map((c) => c.name), ['lookup']);
});

test('OpenInference attributes', () => {
  const n = normalizeLlm(
    span({
      'openinference.span.kind': 'LLM',
      'llm.provider': 'anthropic',
      'llm.model_name': 'claude-x',
      'llm.token_count.prompt': 11,
      'llm.token_count.completion': 4,
      'llm.input_messages.0.message.role': 'user',
      'llm.input_messages.0.message.content': 'hi from openinference',
      'llm.output_messages.0.message.role': 'assistant',
      'llm.output_messages.0.message.content': 'hello back',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.name': 'search',
      'llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments': '{"q":"x"}',
    }),
  );
  assert.deepEqual([n.provider, n.model, n.inputTokens, n.outputTokens], ['anthropic', 'claude-x', 11, 4]);
  assert.equal(n.messages[0].content, 'hi from openinference');
  assert.equal(n.response, 'hello back');
  assert.deepEqual(n.toolCalls, [{ id: '', name: 'search', arguments: '{"q":"x"}' }]);
});

test('source order: current attributes win over events, legacy and OpenInference', () => {
  const n = normalizeLlm(
    span(
      {
        'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'current' }] }]),
        'gen_ai.prompt.0.role': 'user',
        'gen_ai.prompt.0.content': 'legacy',
        'llm.input_messages.0.message.content': 'oi',
      },
      [{ name: 'gen_ai.user.message', attributes: { content: 'event' } }],
    ),
  );
  assert.deepEqual(n.messages.map((m) => m.content), ['current']);
});

test('the inference details event carries the current attributes', () => {
  const n = normalizeLlm(
    span({}, [], [
      {
        eventName: 'gen_ai.client.inference.operation.details',
        body: null,
        attributes: {
          'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'q' }] }]),
          'gen_ai.output.messages': JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'a' }], finish_reason: 'stop' }]),
        },
      },
    ]),
  );
  assert.equal(n.messages[0].content, 'q');
  assert.equal(n.response, 'a');
  assert.equal(n.finishReason, 'stop');
});
