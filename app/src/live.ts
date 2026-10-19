import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { appHeaders } from "./http/securityHeaders.ts";
const events = new EventEmitter(); events.setMaxListeners(40);
let clients=0;
const responses=new Set<ServerResponse>();
export function closeLiveClients(){for(const response of responses)response.end();}
export function publishUpdate(topic: "jobs" | "pc") { events.emit("update",{topic,at:new Date().toISOString()}); }
export function handleLive(req:IncomingMessage,res:ServerResponse){
 if(req.method!=="GET" || clients>=32 || req.headers.origin && req.headers.origin!=="https://"+req.headers.host && req.headers.origin!=="http://"+req.headers.host){res.writeHead(403);res.end();return;}
 clients++;responses.add(res);res.writeHead(200,{...appHeaders(),"Content-Type":"text/event-stream","Cache-Control":"no-store","Connection":"keep-alive","X-Accel-Buffering":"no"});
 const send=(value:unknown)=>res.write("data: "+JSON.stringify(value)+"\n\n");
 const listener=(value:unknown)=>{send(value);};events.on("update",listener);send({topic:"ready"});
 const timer=setInterval(()=>res.write(": heartbeat\n\n"),20000);
 req.once("close",()=>{clearInterval(timer);events.off("update",listener);responses.delete(res);clients--;});
}
