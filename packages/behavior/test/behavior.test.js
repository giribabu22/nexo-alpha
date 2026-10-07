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


// Answers a fixed value per question key, the way a real provider would.
const ANSWERS = {
  action: 'grant',
  risk: 0.2,
  approved: true,
  target: 'billing-agent',
  matches: true,
  quality: 0.9,
  shouldRetry: true,
  strategy: 'backoff',
  status: 'COMPLETE',
  confidenceScore: 0.95,
  needsHuman: false
};
const answering = () => new LocalBehaviorProvider((key) => ({ value: ANSWERS[key], confidence: 0.9 }));

test('BehaviorEngine with a LocalBehaviorProvider evaluator', async () => {
  const engine = new BehaviorEngine({ provider: answering() });
  const response = await engine.decide({
    state: { userRole: 'admin' },
    questions: {
      action: choice(['grant', 'deny']),
      risk: score(),
      approved: boolean('Is user authorized?')
    }
  });

  assert.equal(response.results.action.value, 'grant');
  assert.equal(response.results.risk.value, 0.2);
  assert.equal(response.results.approved.value, true);
});

test('without a provider, nothing is answered and every policy reports that it does not know', async () => {
  const engine = new BehaviorEngine();
  assert.equal(engine.getProvider().name, 'local');

  const decided = await engine.decide({ state: {}, questions: { approved: boolean('Is user authorized?') } });
  assert.deepEqual(decided.results, {});

  const verified = await engine.verify({ expected: 'Customer record created', actual: {} });
  assert.equal(verified.status, 'uncertain');
  assert.equal(verified.confidence, 0);

  const retried = await engine.retry({ error: 'ETIMEDOUT', attempt: 1, maxAttempts: 3 });
  assert.equal(retried.retry, false);
  assert.equal(retried.confidence, 0);

  const completed = await engine.complete({ goal: 'Process order' });
  assert.equal(completed.status, 'IN_PROGRESS');
  assert.equal(completed.confidence, 0);

  const escalated = await engine.escalate({ state: {} });
  assert.equal(escalated.escalate, true);
  assert.equal(escalated.confidence, 0);

  const routed = await engine.route({ state: {}, candidates: ['a', 'b'] });
  assert.equal(routed.confidence, 0);
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

test('JevBehaviorProvider needs an endpoint and an apiKey', () => {
  assert.throws(() => new JevBehaviorProvider(), /needs an endpoint and an apiKey/);
  assert.throws(() => new JevBehaviorProvider({ endpoint: 'https://jev.example' }), /needs an endpoint and an apiKey/);
});

test('JevBehaviorProvider reports endpoint failures instead of inventing answers', async (t) => {
  const provider = new JevBehaviorProvider({ endpoint: 'https://jev.example/evaluate', apiKey: 'k' });
  const request = { state: {}, questions: { approved: boolean() } };

  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503, statusText: 'Service Unavailable' }));
  await assert.rejects(provider.evaluate(request), /answered 503/);

  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(provider.evaluate(request), /request to https:\/\/jev\.example\/evaluate failed: fetch failed/);

  const answer = { results: { approved: { value: false, confidence: 0.7 } } };
  t.mock.method(globalThis, 'fetch', async () => Response.json(answer));
  assert.deepEqual(await provider.evaluate(request), answer);
});

test('Layer 2 Policy: route()', async () => {
  const result = await route({
    state: { input: 'Refund request' },
    candidates: ['technical-agent', 'billing-agent', 'sales-agent']
  }, answering());

  assert.equal(result.selected, 'billing-agent');
  assert.equal(result.confidence, 0.9);
});

test('Layer 2 Policy: verify() signal evaluation', async () => {
  const result = await verify({
    expected: 'Customer record created',
    actual: { id: 'cust_123', status: 'created' }
  }, answering());

  assert.equal(result.status, 'verified');
  assert.equal(result.confidence, 0.9);
});

test('Layer 2 Policy: retry() evaluation', async () => {
  const result = await retry({
    error: 'ETIMEDOUT',
    attempt: 1,
    maxAttempts: 3
  }, answering());

  assert.equal(result.retry, true);
  assert.equal(result.strategy, 'backoff');
});

test('Layer 2 Policy: complete() checking', async () => {
  const result = await complete({
    goal: 'Process order',
    history: ['payment_received', 'item_shipped']
  }, answering());

  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.confidence, 0.9);
});

test('Layer 2 Policy: escalate() policy', async () => {
  const result = await escalate({
    state: { transactionValue: 50000 },
    confidenceThreshold: 0.90
  }, answering());

  assert.equal(result.escalate, false);
  assert.equal(result.action, 'ACT');
});

test('TelemetryTracker measures evaluation duration and token savings', async () => {
  const engine = new BehaviorEngine({ provider: answering() });
  await engine.route({ state: {}, candidates: ['a', 'b'] });
  await engine.verify({ expected: 'ok', actual: 'ok' });

  const metrics = engine.getMetrics();
  assert.equal(metrics.totalEvaluations, 2);
  assert.ok(metrics.estimatedSavedTokens > 0);
  assert.equal(metrics.providerCounts['local'], 2);
});

test('TelemetryTracker credits no generated-token savings for unanswered questions', async () => {
  const engine = new BehaviorEngine({ tokenOptimization: { compress: false, promptCache: false, budget: false } });
  await engine.verify({ expected: 'ok', actual: 'ok' });

  // Only the payload trimmed by selective injection remains; the 250-per-question credit is gone.
  assert.ok(engine.getMetrics().estimatedSavedTokens < 250);
});

test('the provider sees each policy\'s full state, on every call', async () => {
  const seen = [];
  const engine = new BehaviorEngine({
    provider: { name: 'spy', async evaluate(request) { seen.push(request.state); return { results: {} }; } }
  });

  await engine.route({ state: { ticket: 'React hydration issue' }, candidates: ['billing', 'technical'] });
  await engine.verify({ expected: 'mentions React', actual: { title: 'React 20 Docs' } });
  await engine.verify({ expected: 'mentions React', actual: { title: 'Migration guide' } });
  await engine.retry({ error: 'ETIMEDOUT', attempt: 1, maxAttempts: 3, context: { step: 2 } });
  await engine.complete({ goal: 'Answer the question', history: ['found docs'] });
  await engine.escalate({ state: { amount: 50000 }, context: 'refund' });

  assert.deepEqual(seen, [
    { state: { ticket: 'React hydration issue' } },
    { expected: 'mentions React', actual: { title: 'React 20 Docs' } },
    { expected: 'mentions React', actual: { title: 'Migration guide' } },
    { error: 'ETIMEDOUT', attempt: 1, maxAttempts: 3, context: { step: 2 } },
    { goal: 'Answer the question', history: ['found docs'] },
    { state: { amount: 50000 }, context: 'refund' }
  ]);
});

test('answers outside their question\'s bounds count as unanswered', async () => {
  const answers = {
    pick: { value: 'maybe', confidence: 0.9 },        // not an option
    rating: { value: 7, confidence: 0.9 },            // score above max 1
    nan: { value: Number.NaN, confidence: 0.9 },      // not a finite number
    flag: { value: 'false', confidence: 0.9 },        // a string, not a boolean
    sure: { value: true, confidence: 1.5 },           // confidence above 1
    good: { value: 'b', confidence: 0.7 },
    extra: { value: true, confidence: 0.9 }           // a question that wasn't asked
  };
  const engine = new BehaviorEngine({ provider: { name: 'loose', async evaluate() { return { results: answers }; } } });

  const response = await engine.decide({
    state: {},
    questions: {
      pick: choice(['a', 'b']),
      rating: score(),
      nan: score(),
      flag: boolean(),
      sure: boolean(),
      good: choice(['a', 'b'])
    }
  });

  assert.deepEqual(Object.keys(response.results), ['good']);

  const verified = await new BehaviorEngine({
    provider: { name: 'stringly', async evaluate() { return { results: { matches: { value: 'false', confidence: 0.9 }, quality: { value: 0.9, confidence: 0.9 } } }; } }
  }).verify({ expected: 'x', actual: 'y' });
  assert.equal(verified.status, 'uncertain');
});
