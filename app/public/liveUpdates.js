let connection;
export function startLiveUpdates(){
 if(connection || !globalThis.EventSource)return;
 connection=new EventSource('/api/live');
 connection.onmessage=event=>{try{const message=JSON.parse(event.data);if(['jobs','pc','ready'].includes(message.topic)){
   if(message.topic==='jobs'||message.topic==='ready')document.dispatchEvent(new Event('jarvis:jobs-updated'));
   if(message.topic==='pc'||message.topic==='ready')document.dispatchEvent(new Event('jarvis:pc-updated'));
 }}catch{}};
}
