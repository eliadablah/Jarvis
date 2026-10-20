import {test} from "node:test";
import assert from "node:assert/strict";
import {writeTrackerReceipt} from "../src/jobs/trackerWrite.ts";
import {sharedTrackerView} from "../src/jobs/api.ts";
import {parseRows,summarize} from "../src/jobs/tracker.ts";
const headers=["Date Applied","Company","Role","Pay","Location","Stage","Next Step / Needs You","Last Update","CV Used","Apply Via","Posting URL","Notes"];
const receipt={id:"private-id",taskId:"private-task",company:"=Company",role:"Support",url:"https://example.com/new",confirmation:"private confirmation",at:"2026-10-20T01:00:00Z",sync:"pending" as const};
const literal=(v:string)=>({userEnteredValue:{stringValue:v}});
function fixture(stage="Submitted",url="https://example.com/old"){
 const table:any={sheets:[{properties:{sheetId:123},data:[{rowData:[{values:headers.map(literal)},{values:["2026-10-17","Old","Support","private pay","private location",stage,"private next","2026-10-17","private cv","Browser",url,"private notes"].map(literal)}]}]}]};
 table.sheets[0].data[0].rowData[1].values[10].userEnteredFormat={textFormat:{bold:true,link:{uri:url}}};
 table.sheets[0].data[0].rowData[1].values[5].dataValidation={condition:{type:"ONE_OF_LIST",values:[{userEnteredValue:"Submitted"}]} ,strict:true};
 const writes:any[]=[];let loseAck=false;
 const call=async(_suffix:string,body?:any)=>{
   if(!body)return structuredClone(table);
   writes.push(structuredClone(body));
   for(const request of body.requests){
     const grid=table.sheets[0].data[0].rowData;
     if(request.appendCells)grid.push(...structuredClone(request.appendCells.rows));
     if(request.updateCells){const u=request.updateCells;grid[u.range.startRowIndex].values[u.range.startColumnIndex].userEnteredValue=u.rows[0].values[0].userEnteredValue;}
   }
   if(loseAck){loseAck=false;throw Error("Connection lost after Google accepted the write");}
   return {};
 };
 return {table,writes,call,loseAck:()=>{loseAck=true;}};
}
test("Google writes exactly five approved fields, literal text and native structure without private metadata",async()=>{
 const f=fixture();await writeTrackerReceipt("A1:L1000",receipt,f.call);
 const cells=f.writes[0].requests[0].appendCells.rows[0].values;
 assert.deepEqual(cells.flatMap((c:any,i:number)=>c.userEnteredValue?[headers[i]]:[]),["Date Applied","Company","Role","Stage","Posting URL"]);
 assert.equal(cells[1].userEnteredValue.stringValue,"=Company");
 assert.equal(cells[0].userEnteredValue.numberValue,46314);assert.equal(cells[0].userEnteredFormat.numberFormat.type,"DATE");
 assert.equal(cells[10].userEnteredFormat.textFormat.link,undefined);assert.equal(cells[10].userEnteredFormat.textFormat.bold,true);
 assert.equal(cells[5].dataValidation.strict,true);
 for(const secret of ["private-id","private-task","private confirmation","private pay","private location","private next","private cv","private notes"])assert.equal(JSON.stringify(f.writes).includes(secret),false);
});
test("ambiguous Google write is read back on retry without adding a duplicate",async()=>{
 const f=fixture();f.loseAck();await assert.rejects(writeTrackerReceipt("A1:L1000",receipt,f.call),/Connection lost/);
 await writeTrackerReceipt("A1:L1000",receipt,f.call);assert.equal(f.writes.length,1);
});
test("existing URL updates only approved cells; advanced application stages are never downgraded",async()=>{
 const f=fixture("Needs answer",receipt.url);const before=structuredClone(f.table.sheets[0].data[0].rowData[1]);
 await writeTrackerReceipt("A1:L1000",receipt,f.call);
 assert.equal(f.writes[0].requests.length,5);
 for(const i of [3,4,6,7,8,9,11])assert.deepEqual(f.table.sheets[0].data[0].rowData[1].values[i],before.values[i]);
 const advanced=fixture("Interview scheduled",receipt.url);await writeTrackerReceipt("A1:L1000",receipt,advanced.call);assert.equal(advanced.writes.length,0);
});
test("missing headers and formula targets fail before writing",async()=>{
 const f=fixture("Needs answer",receipt.url);f.table.sheets[0].data[0].rowData[1].values[1]={userEnteredValue:{formulaValue:'="Old"'}};
 await assert.rejects(writeTrackerReceipt("A1:L1000",receipt,f.call),/formula/);assert.equal(f.writes.length,0);
 f.table.sheets[0].data[0].rowData[0].values[10]=literal("Unknown");await assert.rejects(writeTrackerReceipt("A1:L1000",receipt,f.call),/headers/);
});
test("shared job history only exposes the approved four fields and aggregate totals",()=>{
 const jobs=parseRows([headers,["2026-10-19","Employer","Role","private pay","private place","Submitted","private next","2026-10-19","private cv","Browser",receipt.url,"private notes"]]);
 const view=sharedTrackerView({jobs,summary:summarize(jobs),updatedAt:receipt.at});
 assert.deepEqual(Object.keys(view.jobs[0]!).sort(),["company","role","stage","url"]);
 assert.equal(view.summary.submitted,1);assert.equal(view.nextOffset,null);assert.equal(JSON.stringify(view).includes("private"),false);
});
