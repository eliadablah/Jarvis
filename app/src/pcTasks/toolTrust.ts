import {emptyApprovalForm} from "./approvalInput.ts";
import type {PcApproval} from "./protocol.ts";
export type ToolTrust = {mode:"ask"|"trusted";updatedAt:string};
/** Ordinary tool consent. Questions, auth and OS permission/escalation requests remain interactive. */
export function rememberedToolConsent(row:Pick<PcApproval,"provider"|"tool"|"details">):boolean {
 let input:Record<string,any>;try{input=JSON.parse(row.details);}catch{return false;}
 if(!input||typeof input!=="object"||Array.isArray(input))return false;
 if(row.tool==="MCP user input")return input._meta?.codex_approval_kind==="mcp_tool_call"&&emptyApprovalForm(input);
 if(row.provider!=="claude")return false;
 return /^mcp__[A-Za-z0-9_-]+__/.test(row.tool)||["Read","Write","Edit","MultiEdit","Glob","Grep","LS","Bash","Skill","Agent","Task","WebFetch","WebSearch","ToolSearch","NotebookEdit","TodoWrite"].includes(row.tool);
}
