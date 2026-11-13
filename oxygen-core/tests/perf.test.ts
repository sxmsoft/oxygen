import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PERF, liteMode, parsePerf } from '../../extension/src/logic/perf.js';

test('performance mode: auto is on for <= 8 GB (deviceMemory caps at 8), explicit choice wins', () => {
  assert.deepEqual(parsePerf(undefined), DEFAULT_PERF);
  assert.equal(DEFAULT_PERF.glass, false, 'frosted glass is opt-in');
  assert.equal(liteMode(DEFAULT_PERF, 8), true);
  assert.equal(liteMode(DEFAULT_PERF, 4), true);
  assert.equal(liteMode(DEFAULT_PERF, undefined), true);
  assert.equal(liteMode(DEFAULT_PERF, 16), false);
  assert.equal(liteMode(parsePerf({ mode: 'off' }), 2), false);
  assert.equal(liteMode(parsePerf({ mode: 'on' }), 32), true);
  assert.deepEqual(parsePerf({ mode: 'weird', glass: 'yes' }), DEFAULT_PERF);
});
