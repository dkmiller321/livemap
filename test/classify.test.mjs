import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressKey, addressOf, classifyKind, columnOf, externalNodeId, providerOf, serviceNodeKind } from '../src/core/classify.mjs';

test('kind rule 1: invoke_agent and create_agent are agent', () => {
  assert.equal(classifyKind({ 'gen_ai.operation.name': 'invoke_agent' }), 'agent');
  assert.equal(classifyKind({ 'gen_ai.operation.name': 'create_agent', 'http.request.method': 'POST' }), 'agent');
});

test('kind rule 2: execute_tool is tool', () => {
  assert.equal(classifyKind({ 'gen_ai.operation.name': 'execute_tool', 'db.system.name': 'postgresql' }), 'tool');
});

test('kind rule 3: any other operation name, or a provider attribute, is llm', () => {
  assert.equal(classifyKind({ 'gen_ai.operation.name': 'chat' }), 'llm');
  assert.equal(classifyKind({ 'gen_ai.operation.name': 'embeddings' }), 'llm');
  assert.equal(classifyKind({ 'gen_ai.provider.name': 'anthropic' }), 'llm');
  assert.equal(classifyKind({ 'gen_ai.system': 'openai', 'http.method': 'POST' }), 'llm');
});

test('kind rule 4: db.system.name or db.system is db', () => {
  assert.equal(classifyKind({ 'db.system.name': 'postgresql' }), 'db');
  assert.equal(classifyKind({ 'db.system': 'mysql', 'messaging.system': 'kafka' }), 'db');
});

test('kind rule 5: messaging.system is queue', () => {
  assert.equal(classifyKind({ 'messaging.system': 'rabbitmq', 'http.request.method': 'POST' }), 'queue');
});

test('kind rule 6: http.request.method, http.method or rpc.system is http', () => {
  assert.equal(classifyKind({ 'http.request.method': 'GET' }), 'http');
  assert.equal(classifyKind({ 'http.method': 'GET' }), 'http');
  assert.equal(classifyKind({ 'rpc.system': 'grpc' }), 'http');
});

test('kind rule 7: anything else is internal', () => {
  assert.equal(classifyKind({}), 'internal');
  assert.equal(classifyKind({ 'code.function': 'render' }), 'internal');
  assert.equal(classifyKind({ 'gen_ai.operation.name': '' }), 'internal');
});

test('K8: OpenInference and OpenLLMetry spans', () => {
  assert.equal(classifyKind({ 'openinference.span.kind': 'LLM' }), 'llm');
  assert.equal(classifyKind({ 'openinference.span.kind': 'AGENT' }), 'agent');
  assert.equal(classifyKind({ 'openinference.span.kind': 'TOOL' }), 'tool');
  assert.equal(classifyKind({ 'llm.request.type': 'chat' }), 'llm');
  assert.equal(classifyKind({ 'traceloop.span.kind': 'tool' }), 'tool');
  assert.equal(classifyKind({ 'openinference.span.kind': 'CHAIN' }), 'internal');
});

test('provider: current, legacy, then OpenInference', () => {
  assert.equal(providerOf({ 'gen_ai.provider.name': 'openai', 'gen_ai.system': 'other' }), 'openai');
  assert.equal(providerOf({ 'gen_ai.system': 'openai' }), 'openai');
  assert.equal(providerOf({ 'llm.provider': 'anthropic' }), 'anthropic');
  assert.equal(providerOf({}), '');
});

test('address: server.*, then net.peer.*, then the URL', () => {
  assert.deepEqual(addressOf({ 'server.address': 'API.Stripe.com', 'server.port': 443 }), { host: 'api.stripe.com', port: '443' });
  assert.deepEqual(addressOf({ 'net.peer.name': 'legacy.example.com', 'net.peer.port': 443 }), { host: 'legacy.example.com', port: '443' });
  assert.deepEqual(addressOf({ 'url.full': 'http://127.0.0.1:4502/orders/1' }), { host: '127.0.0.1', port: '4502' });
  assert.deepEqual(addressOf({ 'http.url': 'https://example.com/x' }), { host: 'example.com', port: '443' });
  assert.deepEqual(addressOf({ 'http.host': 'svc:8080' }), { host: 'svc', port: '8080' });
  assert.deepEqual(addressOf({}), { host: '', port: '' });
});

test('external node id drops :80 and :443 only', () => {
  assert.equal(externalNodeId({ host: 'api.stripe.com', port: '443' }), 'api.stripe.com');
  assert.equal(externalNodeId({ host: 'example.com', port: '80' }), 'example.com');
  assert.equal(externalNodeId({ host: 'orders.internal', port: '9000' }), 'orders.internal:9000');
  assert.equal(externalNodeId({ host: 'x', port: '' }), 'x');
  assert.equal(externalNodeId({ host: '', port: '' }), 'unknown');
  assert.equal(addressKey({ host: 'orders.internal', port: '9000' }), 'orders.internal:9000');
  assert.equal(addressKey({ host: '', port: '' }), '');
});

test('columns: browser and Outside, services, everything else', () => {
  assert.equal(columnOf('browser'), 0);
  assert.equal(columnOf('outside'), 0);
  assert.equal(columnOf('service'), 1);
  for (const k of /** @type {const} */ (['db', 'queue', 'llm', 'external'])) assert.equal(columnOf(k), 2);
  assert.equal(serviceNodeKind('webjs'), 'browser');
  assert.equal(serviceNodeKind('python'), 'service');
});
