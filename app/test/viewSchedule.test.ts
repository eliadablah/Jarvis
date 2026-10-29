import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledDesign, parseViewCommand } from '../public/viewSchedule.js';
test('daily views rotate through all five looks in device local time',()=>{
for(const [h,m,expected] of [[0,0,'d'],[5,59,'d'],[6,0,'b'],[8,59,'b'],[9,0,'d'],[11,59,'d'],[12,0,'a'],[14,59,'a'],[15,0,'e'],[17,59,'e'],[18,0,'c'],[21,59,'c'],[22,0,'d'],[23,59,'d']]) assert.equal(scheduledDesign(new Date(2026,9,15,h,m)),expected,`${h}:${m}`);
});
test('spoken view commands do not change model settings',()=>{
assert.deepEqual(parseViewCommand('Jarvis, switch to view bee'),{mode:'manual',design:'b'});
assert.deepEqual(parseViewCommand('switch to view C'),{mode:'manual',design:'c'});
assert.deepEqual(parseViewCommand('switch to view D'),{mode:'manual',design:'d'});
assert.deepEqual(parseViewCommand('use ember'),{mode:'manual',design:'e'});
assert.deepEqual(parseViewCommand('show aurora'),{mode:'manual',design:'d'});
assert.deepEqual(parseViewCommand('resume automatic views'),{mode:'auto'});
assert.equal(parseViewCommand('use auto model'),null);
});
