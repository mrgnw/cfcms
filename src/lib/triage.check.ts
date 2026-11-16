// node --import ./scripts/check-hooks.ts src/lib/triage.check.ts
import assert from 'node:assert/strict';
import { adoptIncoming, triageOf } from './triage.ts';

const loaded = triageOf({ nextStep: 'Cut the intro', effort: 'quick' });
const elsewhere = triageOf({ nextStep: 'Add a photo', effort: 'deep' });

assert.deepEqual(
	adoptIncoming(loaded, loaded, elsewhere),
	{ saved: elsewhere, shown: elsewhere },
	'an untouched editor shows what another session saved'
);

const editing = { ...loaded, nextStep: 'Fix links' };
assert.deepEqual(
	adoptIncoming(loaded, editing, elsewhere),
	{ saved: { nextStep: 'Cut the intro', effort: 'deep' }, shown: { nextStep: 'Fix links', effort: 'deep' } },
	'an edited field keeps its text and its old base; the untouched field updates'
);

assert.deepEqual(triageOf({}), { nextStep: '', effort: '' });

console.log('triage.check: ok');
