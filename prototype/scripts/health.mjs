import {runtimeConfig} from '../server/runtime.mjs';
const {apiPort,frontendPort}=runtimeConfig();
try{
 const results=await Promise.all([['API',`http://127.0.0.1:${apiPort}/api/health`],['网页',`http://127.0.0.1:${frontendPort}/`],['网页代理',`http://127.0.0.1:${frontendPort}/api/health`]].map(async([name,url])=>{const r=await fetch(url,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw new Error(`${name}: HTTP ${r.status}`);return `${name}: OK${name==='网页'?'':` (${(await r.json()).mode})`}`;}));
 console.log(results.join('\n'));
}catch(error){console.error(`健康检查失败：${error.message}`);process.exitCode=1;}
