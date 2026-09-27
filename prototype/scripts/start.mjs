import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {runtimeConfig} from '../server/runtime.mjs';

// Foreground supervisor: Ctrl+C stops only the children started by this command.
const mode=process.argv[2]||'demo';
if(!['demo','research','legacy'].includes(mode))throw new Error('用法：node scripts/start.mjs [demo|research|legacy]');
const env={...process.env,SIGNAL_MODE:mode},config=runtimeConfig(env);
const cwd=fileURLToPath(new URL('../',import.meta.url));
const available=port=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});
try{await available(config.apiPort);await available(config.frontendPort);}catch(error){console.error(`端口不可用，未启动服务：${error.message}\n保留已运行的服务；可设置 SIGNAL_FRONTEND_PORT 和 SIGNAL_API_PORT 使用另一组端口。`);process.exit(1);}
const children=[];let stopping=false,timer;
function stop(code){if(stopping)return;stopping=true;clearTimeout(timer);for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');process.exit(code);},2500).unref();process.exitCode=code;}
for(const args of [['server/index.mjs'],['node_modules/vite/bin/vite.js']]){
 const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit'});children.push(child);
 child.once('error',error=>{console.error(error.message);stop(1);});
 child.once('exit',code=>{if(!stopping)stop(code||1);});
}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>stop(0));
timer=setTimeout(()=>{console.error('启动超时，请检查上面的错误信息。');stop(1);},30000);
while(!stopping){
 try{
  const [api,web]=await Promise.all([fetch(`http://127.0.0.1:${config.apiPort}/api/health`,{signal:AbortSignal.timeout(1000)}),fetch(`http://127.0.0.1:${config.frontendPort}/`,{signal:AbortSignal.timeout(1000)})]);
  if(api.ok&&web.ok&&(await api.json()).mode===mode){clearTimeout(timer);console.log(`\n工作台已就绪：http://127.0.0.1:${config.frontendPort}/\n模式：${mode}；数据：${config.dbPath}\n保持本终端运行，按 Ctrl+C 停止。`);break;}
 }catch{}
 await new Promise(r=>setTimeout(r,250));
}
