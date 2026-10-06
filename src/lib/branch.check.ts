import assert from 'node:assert/strict';
import { mainBranchError } from './branch.ts';

assert.equal(mainBranchError('main'), null, 'main branch is allowed');
assert.ok(mainBranchError('feature/foo')?.includes('feature/foo'), 'other branch is named in the error');
assert.ok(mainBranchError(null)?.includes('unknown'), 'missing branch reads as unknown, not a crash');

console.log('branch.check: ok');
