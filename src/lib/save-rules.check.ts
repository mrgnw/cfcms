import assert from 'node:assert/strict';
import { decideSave, isValidWriter, normalizeNewlines, storedBodyForm } from './save-rules.ts';

assert.equal(decideSave('v14', 'v14', 'v15'), 'write', 'base current → write');
assert.equal(decideSave('v14', 'v14', 'v14'), 'write', 'identical text with current base still writes');
assert.equal(decideSave('v14', 'v15', 'v15'), 'noop', 'stale base but text already converged');
assert.equal(decideSave('v14', 'v15', 'v16'), 'conflict', 'stale base, divergent text');

assert.equal(storedBodyForm('title: x', 'Hello.'), '\nHello.\n', 'with frontmatter the stored body keeps the separator newline');
assert.equal(storedBodyForm('  ', 'Hello.'), 'Hello.', 'no frontmatter → body is the whole file');
assert.equal(storedBodyForm('title: x', 'Hello.\n\n'), '\nHello.\n', 'trailing whitespace normalized like savePost does');

assert.equal(normalizeNewlines('a\r\nb\r\n\r\nc'), 'a\nb\n\nc', 'CRLF never reaches storage — git text=auto would desync blob hashes');
assert.equal(normalizeNewlines('a\nb'), 'a\nb', 'LF untouched');

assert.ok(isValidWriter('mac') && isValidWriter('air2'), 'plain device labels are valid');
assert.ok(!isValidWriter('llm') && !isValidWriter('ext'), 'import labels are reserved');
assert.ok(!isValidWriter('') && !isValidWriter('Mac') && !isValidWriter('toolongname'), 'shape enforced');

console.log('save-rules.check: ok');
