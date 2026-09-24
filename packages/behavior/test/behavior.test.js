import test from 'node:test';
import assert from 'node:assert/strict';

import {
  choice,
  score,
  boolean,
  LocalBehaviorProvider,
  JevBehaviorProvider,
  BehaviorEngine,
  route,
  verify,
  retry,
  complete,
  escalate
} from '../dist/index.js';

test('Layer 1 Atomic Primitives', () => {
  const choiceDef = choice(['a', 'b', 'c'], 'Select one option');
  assert.equal(choiceDef.type, 'choice');
  assert.deepEqual(choiceDef.options, ['a', 'b', 'c']);

  const scoreDef = score({ min: 0, max: 10, description: 'Score out of 10' });
  assert.equal(scoreDef.type, 'score');
  assert.equal(scoreDef.min, 0);
  assert.equal(scoreDef.max, 10);

  const boolDef = boolean('Must be true', 'Criteria check');
  assert.equal(boolDef.type, 'boolean');
  assert.equal(boolDef.criteria, 'Must be true');
});

test('BehaviorEngine with LocalBehaviorProvider', async () => {
  const engine = new BehaviorEngine({ provider: new LocalBehaviorProvider() });
  const response = await engine.decide({
    state: { userRole: 'admin' },
    questions: {
      action: choice(['grant', 'deny']),
      risk: score(),
      approved: boolean('Is user authorized?')
    }
  });

  assert.ok(response.results.action);
  assert.equal(response.results.action.value, 'grant');
  assert.ok(response.results.risk);
  assert.ok(response.results.approved);
});

test('JevBehaviorProvider pluggability', async () => {
  const jevProvider = new JevBehaviorProvider({
    mockResults: {
      target: { value: 'technical', confidence: 0.98, explanation: 'Jev model classified as technical' }
    }
  });

  const engine = new BehaviorEngine({ provider: jevProvider });
  assert.equal(engine.getProvider().name, 'jev');

  const result = await engine.route({
    state: { ticket: 'API timeout error' },
    candidates: ['billing', 'technical', 'sales']
  });

  assert.equal(result.selected, 'technical');
  assert.equal(result.confidence, 0.98);
});

test('Layer 2 Policy: route()', async () => {
  const result = await route({
    state: { input: 'Refund request' },
    candidates: ['billing-agent', 'technical-agent', 'sales-agent']
  });

  assert.equal(result.selected, 'billing-agent');
  assert.ok(result.confidence > 0);
});

test('Layer 2 Policy: verify() signal evaluation', async () => {
  const result = await verify({
    expected: 'Customer record created',
    actual: { id: 'cust_123', status: 'created' }
  });

  assert.equal(result.status, 'verified');
  assert.ok(result.confidence > 0);
});

test('Layer 2 Policy: retry() evaluation', async () => {
  const result = await retry({
    error: 'ETIMEDOUT',
    attempt: 1,
    maxAttempts: 3
  });

  assert.equal(result.retry, true);
  assert.equal(result.strategy, 'backoff');
});

test('Layer 2 Policy: complete() checking', async () => {
  const result = await complete({
    goal: 'Process order',
    history: ['payment_received', 'item_shipped']
  });

  assert.ok(result.status);
  assert.ok(result.confidence > 0);
});

test('Layer 2 Policy: escalate() policy', async () => {
  const result = await escalate({
    state: { transactionValue: 50000 },
    confidenceThreshold: 0.90
  });

  assert.ok(typeof result.escalate === 'boolean');
  assert.ok(result.action);
});

test('TelemetryTracker measures evaluation duration and token savings', async () => {
  const engine = new BehaviorEngine({ provider: new LocalBehaviorProvider() });
  await engine.route({ state: {}, candidates: ['a', 'b'] });
  await engine.verify({ expected: 'ok', actual: 'ok' });

  const metrics = engine.getMetrics();
  assert.equal(metrics.totalEvaluations, 2);
  assert.ok(metrics.estimatedSavedTokens > 0);
  assert.equal(metrics.providerCounts['local'], 2);
});
