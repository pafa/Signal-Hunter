import {pathToFileURL} from 'node:url';
import {resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const controller=new AbortController(),cancel=()=>controller.abort();
process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
let api,input;
try{
 process.stdin.setEncoding('utf8');let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>12*1024*1024)throw Error();}
 input=JSON.parse(text);
 if(!isAbsolute(input.root)||!['prepare','run'].includes(input.action))throw Error();
 // This is explicitly selected, trusted project code. It is not a plugin loader
 // for downloaded or unreviewed code, and never opens the research database.
 api=await import(pathToFileURL(resolve(input.root,'prototype/server/codex-research.mjs')).href);
 const contract=packet=>{api.validatePacket(packet);const prompt=api.codexPrompt(packet),schema=api.codexDraftSchema(packet);return {packetHash:digest(packet),prompt,promptHash:digest(prompt),promptVersion:api.CODEX_PROMPT_VERSION,schema,schemaHash:digest(schema),schemaVersion:api.CODEX_SCHEMA_VERSION};};
 let value;
 if(input.action==='prepare')value=input.packets.map(contract);
 else{
  const before=contract(input.packet),candidate=await api.generateCodexDraft(input.packet,{...input.config,signal:controller.signal});
  if(controller.signal.aborted)throw new api.CodexResearchError('cancelled');
  const after=contract(input.packet);if(digest(before)!==digest(after))throw Error();
  api.validateCodexDraft(JSON.parse(candidate.rawOutput),input.packet);
  value={contract:before,candidate};
 }
 process.stdout.write(JSON.stringify({ok:true,value}));
}catch(error){
 const known=api&&error instanceof api.CodexResearchError;
 process.stdout.write(JSON.stringify({ok:false,failure:{code:controller.signal.aborted?'cancelled':known?error.code:'process',message:known?error.message:'候选程序调用或契约检查失败',...(known?{trace:error.trace}:{})},outputDiagnostic:known?api.rejectedOutputDiagnostic(error,input?.packet?.inputHash):undefined}));
}finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
