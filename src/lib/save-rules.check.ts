import assert from 'node:assert/strict';
import { decideSave, isValidWriter, normalizeNewlines } from './save-rules.ts';

assert.equal(decideSave('v14', 'v14', 'v15'), 'write', 'base current → write');
assert.equal(decideSave('v14', 'v14', 'v14'), 'write', 'identical text with current base still writes');
assert.equal(decideSave('v14', 'v15', 'v15'), 'noop', 'stale base but text already converged');
assert.equal(decideSave('v14', 'v15', 'v16'), 'conflict', 'stale base, divergent text');

assert.equal(normalizeNewlines('a\r\nb\r\n\r\nc'), 'a\nb\n\nc', 'CRLF never reaches storage — git text=auto would desync blob hashes');
assert.equal(normalizeNewlines('a\nb'), 'a\nb', 'LF untouched');

assert.ok(isValidWriter('mac') && isValidWriter('air2'), 'plain device labels are valid');
assert.ok(!isValidWriter('llm') && !isValidWriter('ext'), 'import labels are reserved');
assert.ok(!isValidWriter('') && !isValidWriter('Mac') && !isValidWriter('toolongname'), 'shape enforced');

console.log('save-rules.check: ok');
