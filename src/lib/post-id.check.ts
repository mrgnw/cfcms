// node src/lib/post-id.check.ts
import assert from 'node:assert/strict';
import { isPostId, postIdAlphabet, randomPostId } from './post-id.ts';

const counts = new Map<string, number>();
for (let index = 0; index < 20000; index += 1) {
	const id = randomPostId();
	assert.ok(isPostId(id), id);
	for (const char of id) counts.set(char, (counts.get(char) ?? 0) + 1);
}
assert.equal(counts.size, postIdAlphabet.length);
const expected = (20000 * 6) / postIdAlphabet.length;
for (const [char, count] of counts) assert.ok(Math.abs(count - expected) < expected * 0.1, `${char}: ${count}`);

for (const bad of ['', 'abcde', 'abcdefg', 'abcde1', 'ABCDEF', 'abcdel', 'abc-de', 'routing-smoke-test']) {
	assert.equal(isPostId(bad), false, bad);
}
console.log('post-id ok');
