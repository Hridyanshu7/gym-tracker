import test from 'node:test';
import assert from 'node:assert/strict';
import {previousDate,isLockedDate,isCorrectionDate} from '../app/day-window.js';

test('yesterday stays editable until the next local calendar day',()=>{
  const today='2026-11-18';
  assert.equal(isLockedDate('2026-11-16',today),true);
  assert.equal(isLockedDate('2026-11-17',today),false);
  assert.equal(isCorrectionDate('2026-11-17',today),true);
  assert.equal(isLockedDate('2026-11-18',today),false);
  assert.equal(isLockedDate('2026-11-19',today),false);
  assert.equal(isLockedDate('2026-11-17','2026-11-19'),true);
});

test('the correction window crosses month and year boundaries',()=>{
  assert.equal(previousDate('2027-01-01'),'2026-12-31');
  assert.equal(isLockedDate('2026-12-31','2027-01-01'),false);
  assert.equal(isLockedDate('2026-12-30','2027-01-01'),true);
});
