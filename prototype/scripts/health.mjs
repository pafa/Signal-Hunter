import {runtimeConfig} from '../server/runtime.mjs';
const {apiPort,frontendPort,production}=runtimeConfig();
const deployed=production||process.argv.includes('--production');
try{
 const paths=deployed?[['网页',frontendPort,'/'],['同源 API',frontendPort,'/api/health']]:[['API',apiPort,'/api/health'],['网页',frontendPort,'/'],['网页代理',frontendPort,'/api/health']];
 const results=await Promise.all(paths.map(async([name,port,path])=>{
  const r=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw new Error(`${name}: HTTP ${r.status}`);
  return `${name}: OK${path==='/'?'':` (${(await r.json()).mode})`}`;
 }));
 console.log(results.join('\n'));
}catch(error){console.error('健康检查失败：'+error.message);process.exitCode=1;}
