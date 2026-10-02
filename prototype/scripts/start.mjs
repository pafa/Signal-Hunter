import {spawn} from 'node:child_process';
import net from 'node:net';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runtimeConfig,checkDatabaseFile} from '../server/runtime.mjs';
const args=process.argv.slice(2),env={...process.env};
if(args[0]==='--instance'){
 if(args.length!==2)throw new Error('用法：npm run start:instance -- <绝对路径.instance.json>');
 if(env.SIGNAL_INSTANCE_PROFILE&&env.SIGNAL_INSTANCE_PROFILE!==args[1])throw new Error('实例路径与已有环境配置冲突');
 env.SIGNAL_INSTANCE_PROFILE=args[1];args.splice(0,2);
}
if(args.some(x=>x.startsWith('--')&&x!=='--production'))throw new Error('未知启动选项');
if(args.filter(x=>!x.startsWith('--')).length>1)throw new Error('只能指定一个运行模式');
if(args.find(x=>!x.startsWith('--')))env.SIGNAL_MODE=args.find(x=>!x.startsWith('--'));
if(args.includes('--production'))env.SIGNAL_SERVE_STATIC='1';
if(!env.SIGNAL_INSTANCE_PROFILE){env.SIGNAL_MODE||='demo';env.SIGNAL_SERVE_STATIC||='0';}
const config=runtimeConfig(env),{mode,production}=config;
const cwd=fileURLToPath(new URL('../',import.meta.url));
checkDatabaseFile(config);
if(production&&!existsSync(cwd+'dist/index.html'))throw new Error('生产文件不存在，请先运行 npm run build');
const available=port=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});
try{for(const port of production?[config.frontendPort]:[config.apiPort,config.frontendPort])await available(port);}
catch(error){console.error('端口不可用，保留已有服务：'+error.message);process.exit(1);}
const commands=production?[['server/index.mjs']]:[['server/index.mjs'],['node_modules/vite/bin/vite.js']];
const children=new Set();let stopping=false,restarts=0,readyTimer;
function stop(code){
 if(stopping)return;stopping=true;clearTimeout(readyTimer);
 for(const child of children)child.kill('SIGTERM');
 const timer=setTimeout(()=>{for(const child of children)child.kill('SIGKILL');process.exit(code);},10000);timer.unref();
 process.exitCode=code;
}
function launch(command){
 if(stopping)return;
 const child=spawn(process.execPath,command,{cwd,env,stdio:'inherit'});children.add(child);
 child.once('error',error=>{console.error(error.message);stop(1);});
 child.once('exit',(code,signal)=>{
  children.delete(child);if(stopping)return;
  if(!production||++restarts>5){console.error('服务退出或重启次数超限，请检查运行日志。');stop(1);return;}
  const wait=Math.min(1000*2**(restarts-1),30000);
  console.error(`服务中断（${signal||code}），${wait}ms 后恢复，第 ${restarts}/5 次。`);
  setTimeout(()=>launch(command),wait);
 });
}
commands.forEach(launch);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>stop(0));
readyTimer=setTimeout(()=>{console.error('启动超时');stop(1);},30000);
while(!stopping){
 try{
  const base='http://127.0.0.1:',port=production?config.frontendPort:config.apiPort;
  const [api,web]=await Promise.all([fetch(base+port+'/api/health',{signal:AbortSignal.timeout(1000)}),fetch(base+config.frontendPort+'/',{signal:AbortSignal.timeout(1000)})]);
  const health=api.ok?await api.json():null;
  if(api.ok&&web.ok&&health.mode===mode&&health.instance?.id===config.instance.id){clearTimeout(readyTimer);console.log(`工作台已就绪：http://127.0.0.1:${config.frontendPort}/\n实例：${config.instance.label} · ${config.instance.fixed?'固定入口':'未固定入口'}\n模式：${mode} · ${production?'生产静态文件':'开发模式'}\n数据：${config.dbPath}\nCtrl+C 停止；后台常驻请使用经核对的服务配置。`);break;}
 }catch{}
 await new Promise(r=>setTimeout(r,250));
}
