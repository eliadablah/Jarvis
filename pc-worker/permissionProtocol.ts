import {emptyApprovalForm} from "../app/src/pcTasks/approvalInput.ts";
export type AskPermission=(tool:string,input:unknown)=>Promise<{allow:boolean;answer?:string}>;
export async function elicitationPermission(params:Record<string,any>,ask:AskPermission){
 const result=await ask("MCP user input",params);
 if(!result.allow)return {action:"decline"};
 if(params.mode==="url")return {action:"accept"};
 if(emptyApprovalForm(params))return {action:"accept",content:{}};
 if(!result.answer?.trim())return {action:"decline"};
 try{const content=JSON.parse(result.answer);return content&&typeof content==="object"&&!Array.isArray(content)?{action:"accept",content}:{action:"decline"};}catch{return {action:"decline"};}
}
function answers(questions:any[],text:string|undefined,key:string):Record<string,any>|undefined {
 if(!text?.trim())return;
 if(questions.length===1)return {[questions[0][key]]:text.trim()};
 try{const parsed=JSON.parse(text);if(questions.every(q=>typeof parsed[q[key]]==="string"&&parsed[q[key]].trim()))return parsed;}catch{}return;
}
export async function claudePermission(tool:string,input:Record<string,any>,ask:AskPermission){
 const result=await ask(tool,input);if(!result.allow)return {behavior:"deny",message:"User declined this action or approval expired."};
 if(tool==="AskUserQuestion"){
  const supplied=answers(input.questions??[],result.answer,"question");
  return supplied?{behavior:"allow",updatedInput:{...input,answers:supplied}}:{behavior:"deny",message:"A real answer is required; no answer was assumed."};
 }
 return {behavior:"allow",updatedInput:input};
}
export async function codexPermission(method:string,params:Record<string,any>,ask:AskPermission){
 if(!["item/commandExecution/requestApproval","item/fileChange/requestApproval","item/permissions/requestApproval","item/tool/requestUserInput","mcpServer/elicitation/request"].includes(method))throw Error("Unsupported provider request: "+method);
 if(method==="mcpServer/elicitation/request")return elicitationPermission(params,ask);
 const result=await ask(method,params);
 if(method==="item/permissions/requestApproval")return {permissions:result.allow?params.permissions??{}:{},scope:"turn"};
 if(method==="item/tool/requestUserInput"){
  const supplied=result.allow?answers(params.questions??[],result.answer,"id"):undefined;
  return {answers:supplied?Object.fromEntries(Object.entries(supplied).map(([id,answer])=>[id,{answers:[answer]}])):{}};
 }
 return {decision:result.allow?"accept":"decline"};
}
