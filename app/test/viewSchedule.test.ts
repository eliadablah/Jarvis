import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledDesign, parseViewCommand } from '../public/viewSchedule.js';
test('daily views change at 6AM, 11:30AM and 7PM in device local time',()=>{
for(const [h,m,expected] of [[0,0,'c'],[5,59,'c'],[6,0,'b'],[11,29,'b'],[11,30,'a'],[18,59,'a'],[19,0,'c'],[23,59,'c']]) assert.equal(scheduledDesign(new Date(2026,9,15,h,m)),expected);
});
test('spoken view commands do not change model settings',()=>{
assert.deepEqual(parseViewCommand('Jarvis, switch to view bee'),{mode:'manual',design:'b'});
assert.deepEqual(parseViewCommand('switch to view C'),{mode:'manual',design:'c'});
assert.deepEqual(parseViewCommand('resume automatic views'),{mode:'auto'});
assert.equal(parseViewCommand('use auto model'),null);
});
