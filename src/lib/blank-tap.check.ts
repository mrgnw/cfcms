import assert from 'node:assert/strict';
import { focusOnBlankTap } from './blank-tap.ts';

const area = new EventTarget();
const inside = new EventTarget();
const taps: [number, number][] = [];
const detach = focusOnBlankTap((x, y) => taps.push([x, y]))(area as HTMLElement);

function fire(type: string, target: EventTarget, init: Record<string, unknown> = {}) {
	const event = Object.assign(new Event(type), { button: 0, isPrimary: true, clientX: 7, clientY: 9 }, init);
	Object.defineProperty(event, 'target', { value: target });
	area.dispatchEvent(event);
}

function gesture(down: Record<string, unknown>, endType = 'click', endTarget: EventTarget = area) {
	fire('pointerdown', area, down);
	fire('pointerup', endTarget);
	fire(endType, endTarget);
}

gesture({});
assert.deepEqual(taps, [[7, 9]]);

taps.length = 0;
gesture({ button: 2 });
gesture({ button: 1 });
gesture({ isPrimary: false });
assert.deepEqual(taps, []);

fire('pointerdown', area);
fire('pointercancel', area);
fire('click', area);
assert.deepEqual(taps, []);

fire('pointerdown', inside);
fire('pointerup', inside);
fire('click', inside);
assert.deepEqual(taps, []);

gesture({}, 'click', inside);
assert.deepEqual(taps, []);

fire('click', area, { button: 2 });
assert.deepEqual(taps, []);

detach?.();
gesture({});
assert.deepEqual(taps, []);
