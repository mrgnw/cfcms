import assert from 'node:assert/strict';
import { lagBatchMaxBytes, lagBatchMaxEvents, parseLagBatch } from './lag.ts';

const valid = { device: 'ph', editor: 'aragonite', path: '/posts/a', inputs: 40, slow: 1, events: [{ paintMs: 120 }] };
const parse = (value: unknown) => parseLagBatch(JSON.stringify(value));

assert.deepEqual(parse(valid), valid, 'well-formed batch passes through');
assert.deepEqual(parse({ ...valid, extra: 'dropped' }), valid, 'unknown top-level keys are dropped');
assert.ok(parse({ ...valid, inputs: 0, slow: 0, events: [] }), 'empty heartbeat is valid');

assert.equal(parseLagBatch('not json'), null, 'bad json');
assert.equal(parse([valid]), null, 'array instead of object');
assert.equal(parse({ ...valid, device: 3 }), null, 'device must be a string');
assert.equal(parse({ ...valid, path: 'x'.repeat(201) }), null, 'labels are bounded');
assert.equal(parse({ ...valid, inputs: -1 }), null, 'negative count');
assert.equal(parse({ ...valid, inputs: 1.5 }), null, 'fractional count');
assert.equal(parse({ ...valid, events: [1] }), null, 'events must be objects');
assert.equal(parse({ ...valid, events: Array(lagBatchMaxEvents + 1).fill({}) }), null, 'event count is bounded');
assert.equal(parseLagBatch(' '.repeat(lagBatchMaxBytes + 1)), null, 'body size is bounded');

console.log('lag.check: ok');
