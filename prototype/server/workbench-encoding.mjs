import {gzip} from 'node:zlib';
import {promisify} from 'node:util';

const compress=promisify(gzip);
function qualities(header){
 const values=new Map();
 for(const part of typeof header==='string'?header.split(','):[]){
  const [name,...params]=part.trim().toLowerCase().split(';').map(v=>v.trim());
  if(!name)continue;
  let q=1;
  if(params.length){
   const match=params.length===1&&/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.exec(params[0]);
   q=match?Number(match[1]):0;
  }
  // Conflicting duplicates must not undo an explicit refusal.
  values.set(name,Math.min(values.get(name)??1,q));
 }
 return {gzip:values.get('gzip')??values.get('*')??0,identity:values.get('identity')??(values.get('*')===0?0:1)};
}

// HTTP encoding only: the projected JSON and its content validators stay exact.
// Async zlib keeps compression work off the request/event-loop thread.
export async function encodeWorkbenchBody(body,acceptEncoding){
 const q=qualities(acceptEncoding),bytes=Buffer.byteLength(body),headers={Vary:'Accept-Encoding'};
 if(!q.gzip&&!q.identity)return {status:406,body:JSON.stringify({error:'不支持请求的响应编码'}),headers};
 if(q.gzip>0&&q.gzip>=q.identity&&(bytes>=1024||!q.identity)){
  const compressed=await compress(body,{level:1});
  if(compressed.length<bytes||!q.identity)return {status:200,body:compressed,headers:{...headers,'Content-Encoding':'gzip','Content-Length':compressed.length}};
 }
 return {status:200,body,headers:{...headers,'Content-Length':bytes}};
}
