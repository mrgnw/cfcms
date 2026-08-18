import assert from 'node:assert/strict';
import { decideSave, storedBodyForm } from './save-rules.ts';

assert.equal(decideSave('v14', 'v14', 'v15'), 'write', 'base current → write');
assert.equal(decideSave('v14', 'v14', 'v14'), 'write', 'identical text with current base still writes');
assert.equal(decideSave('v14', 'v15', 'v15'), 'noop', 'stale base but text already converged');
assert.equal(decideSave('v14', 'v15', 'v16'), 'conflict', 'stale base, divergent text');

assert.equal(storedBodyForm('title: x', 'Hello.'), '\nHello.\n', 'with frontmatter the stored body keeps the separator newline');
assert.equal(storedBodyForm('  ', 'Hello.'), 'Hello.', 'no frontmatter → body is the whole file');
assert.equal(storedBodyForm('title: x', 'Hello.\n\n'), '\nHello.\n', 'trailing whitespace normalized like savePost does');

console.log('save-rules.check: ok');
