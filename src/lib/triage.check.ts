// node --import ./scripts/check-hooks.ts src/lib/triage.check.ts
import assert from 'node:assert/strict';
import { TriageSync, triageOf, type TriageReply, type TriageView } from './triage.ts';
import type { TriageField } from './types.ts';

type Call = { field: TriageField; value: string; base: string; reply: (reply: TriageReply) => void; fail: () => void };

// a transport the test answers by hand, so replies can arrive in any order relative to edits and polls
const harness = (initial = triageOf({})) => {
	const calls: Call[] = [];
	let view: TriageView | null = null;
	let savedCount = 0;
	const sync = new TriageSync(
		initial,
		(field, value, base) =>
			new Promise<TriageReply>((resolve, reject) => {
				calls.push({ field, value, base, reply: resolve, fail: () => reject(new SyntaxError('Unexpected token <')) });
			}),
		(next) => (view = next),
		() => (savedCount += 1)
	);
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	return { sync, calls, settle, view: () => view ?? sync.view(), saved: () => savedCount };
};

{
	const { sync, calls, settle, view } = harness();
	sync.edit('effort', 'quick');
	sync.save('effort');
	await settle();
	sync.edit('effort', 'deep');
	sync.save('effort');
	await settle();
	assert.equal(calls.length, 1, 'the second save waits for the first');
	calls[0].reply({ kind: 'saved', value: 'quick' });
	await settle();
	assert.equal(view().shown.effort, 'deep', 'the confirmation does not revert the newer choice');
	assert.deepEqual([calls[1].value, calls[1].base], ['deep', 'quick'], 'the later choice is sent over the confirmed one');
	calls[1].reply({ kind: 'saved', value: 'deep' });
	await settle();
	assert.equal(view().saved.effort, 'deep', 'the last choice wins');
	assert.equal(view().saving, false);
}

{
	const { sync, calls, settle, view } = harness();
	sync.edit('nextStep', 'Draft');
	sync.save('nextStep');
	sync.edit('nextStep', 'Draft two');
	sync.save('nextStep');
	await settle();
	assert.deepEqual(calls.map((call) => call.value), ['Draft two'], 'edits made before a save starts go out together');
	calls[0].reply({ kind: 'saved', value: 'Draft two' });
	await settle();
	assert.equal(calls.length, 1, 'the queued duplicate sends nothing');
}

{
	const { sync, calls, settle, view } = harness(triageOf({ nextStep: 'Cut the intro' }));
	sync.edit('nextStep', 'Fix links');
	sync.save('nextStep');
	await settle();
	sync.edit('nextStep', 'Fix links and images');
	sync.save('nextStep');
	await settle();
	calls[0].reply({ kind: 'conflict', current: 'Add a photo' });
	await settle();
	assert.equal(calls.length, 1, 'a queued save for a conflicted field is held, not sent over their value');
	assert.deepEqual(view().problems.nextStep, { kind: 'conflict', theirs: 'Add a photo' });
	assert.equal(view().shown.nextStep, 'Fix links and images', 'the writer keeps their text');
	sync.save('nextStep');
	await settle();
	assert.equal(calls.length, 1, 'pressing Enter again does not bypass the choice');
	sync.keepMine('nextStep');
	await settle();
	assert.deepEqual([calls[1].value, calls[1].base], ['Fix links and images', 'Add a photo'], 'Keep mine overwrites knowingly');
	calls[1].reply({ kind: 'saved', value: 'Fix links and images' });
	await settle();
	assert.equal(view().problems.nextStep, undefined);

	sync.edit('nextStep', 'Mine again');
	sync.save('nextStep');
	await settle();
	calls[2].reply({ kind: 'conflict', current: 'Theirs again' });
	await settle();
	sync.useTheirs('nextStep');
	assert.equal(view().shown.nextStep, 'Theirs again', 'Use theirs shows their value');
	assert.equal(view().problems.nextStep, undefined);
}

{
	const { sync, calls, settle, view } = harness();
	sync.edit('effort', 'quick');
	sync.save('effort');
	sync.edit('nextStep', 'Tighten');
	sync.save('nextStep');
	await settle();
	calls[0].fail();
	await settle();
	assert.deepEqual(view().problems.effort, { kind: 'failed' }, 'a malformed reply is reported as not saved');
	assert.equal(calls.length, 2, 'the queue keeps going after a rejected save');
	calls[1].reply({ kind: 'saved', value: 'Tighten' });
	await settle();
	sync.keepMine('effort');
	await settle();
	assert.deepEqual([calls[2].field, calls[2].value, calls[2].base], ['effort', 'quick', ''], 'Retry resends');
	calls[2].reply({ kind: 'failed' });
	await settle();
	assert.deepEqual(view().problems.effort, { kind: 'failed' });
	sync.keepMine('effort');
	await settle();
	calls[3].reply({ kind: 'saved', value: 'quick' });
	await settle();
	assert.deepEqual(view().problems, {}, 'a later retry clears the error');
	assert.equal(view().saving, false);
}

{
	const { sync, calls, settle, view, saved } = harness(triageOf({ nextStep: 'Old', effort: 'quick' }));
	sync.edit('nextStep', 'Mine');
	sync.save('nextStep');
	await settle();
	sync.receive(triageOf({ nextStep: 'Old', effort: 'deep' }));
	assert.equal(view().shown.effort, 'quick', 'a poll arriving mid-save waits');
	calls[0].reply({ kind: 'saved', value: 'Mine' });
	await settle();
	assert.equal(view().shown.effort, 'deep', 'it is applied once the queue drains');
	assert.equal(view().shown.nextStep, 'Mine', 'but not over a field confirmed after that poll arrived');
	assert.equal(saved(), 1);

	sync.receive(triageOf({ nextStep: 'From elsewhere', effort: 'deep' }));
	assert.equal(view().shown.nextStep, 'From elsewhere', 'a poll after the save is applied');

	sync.edit('nextStep', 'Unsaved draft');
	sync.receive(triageOf({ nextStep: 'Newer elsewhere', effort: 'deep' }));
	assert.equal(view().shown.nextStep, 'Unsaved draft', 'an unsaved edit is never replaced');
	assert.equal(view().saved.nextStep, 'From elsewhere', 'and keeps its base, so its save is refused');
}

console.log('triage.check: ok');
