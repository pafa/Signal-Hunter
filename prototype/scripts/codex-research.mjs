import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {generateCodexDraft,validatePacket,CodexResearchError,rejectedOutputDiagnostic} from '../server/codex-research.mjs';

// Input is an exported, immutable research packet. This command never opens a database.
const [packetPath,outputPath,...extra]=process.argv.slice(2);
const controller=new AbortController();
const cancel=()=>controller.abort();
process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
let destination;
try{
 if(!packetPath||!outputPath||extra.length)throw new Error('用法：npm run research:codex -- <材料包.json> <全新输出目录>');
 const inputStat=await stat(packetPath);if(!inputStat.isFile()||inputStat.size>524288)throw new CodexResearchError('packet');
 const packet=validatePacket(JSON.parse(await readFile(packetPath,'utf8')));
 const config={binary:process.env.SIGNAL_CODEX_BIN,model:process.env.SIGNAL_CODEX_MODEL,effort:process.env.SIGNAL_CODEX_EFFORT||'high',timeoutMs:Number(process.env.SIGNAL_CODEX_TIMEOUT_MS||180000),signal:controller.signal};
 destination=resolve(outputPath);await mkdir(destination,{mode:0o700});
 await writeFile(join(destination,'input.json'),JSON.stringify(packet,null,2),{flag:'wx',mode:0o600});
 try{
  const result=await generateCodexDraft(packet,config);
  await writeFile(join(destination,'candidate.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:result.status,model:result.trace.model,sections:result.sections.length,inputHash:result.trace.inputHash,outputHash:result.trace.outputHash,outputDirectory:destination}));
 }catch(error){
  const failed={status:'failed',code:error instanceof CodexResearchError?error.code:'storage',message:error instanceof CodexResearchError?error.message:'候选保存失败',trace:error.trace||{}};
  await writeFile(join(destination,'failure.json'),JSON.stringify({...failed,outputDiagnostic:rejectedOutputDiagnostic(error,packet.inputHash)},null,2),{flag:'wx',mode:0o600});
  console.error(JSON.stringify(failed));process.exitCode=2;
 }
}catch(error){console.error(error instanceof CodexResearchError?error.message:'材料包、参数或输出目录无效；输出目录必须全新且父目录已存在');process.exitCode=1;}
finally{process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);}
