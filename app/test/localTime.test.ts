import {test} from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Browser helpers run directly in Node.
import {formatClock,formatLocalDate,relativeDay} from "../public/localTime.js";
test("local time is explicitly 12-hour with correct noon/midnight and minute precision",()=>{
 assert.equal(formatClock(new Date(2026,9,19,13,0)),"1 PM");
 assert.equal(formatClock(new Date(2026,9,19,15,59)),"3:59 PM");
 assert.equal(formatClock(new Date(2026,9,19,0,0)),"12 AM");
 assert.equal(formatClock(new Date(2026,9,19,12,0)),"12 PM");
 assert.equal(formatLocalDate(new Date(2026,9,19,15,59)),"Monday, October 19, 2026");
});
test("relative dates use calendar rollover rather than a fixed 24-hour day",()=>{
 const now=new Date(2026,9,19,23,59);
 assert.equal(relativeDay(new Date(2026,9,20,0,1),now),"tomorrow");
 assert.equal(relativeDay(new Date(2026,9,19,23,59),now),"today");
});
