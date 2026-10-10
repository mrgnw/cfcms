import assert from 'node:assert/strict';
import { shortDate } from './short-date.ts';

assert.equal(shortDate('2026-09-29', 2026), 'Sep 29');
assert.equal(shortDate('2026-08-05', 2026), 'Aug 5');
assert.equal(shortDate('2025-03-15', 2026), '2025');
assert.equal(shortDate('1970-01-01', 2026), null);
assert.equal(shortDate(undefined, 2026), null);
assert.equal(shortDate('soon', 2026), null);
