import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';

const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function within(promise,ms){let timer;return Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]).finally(()=>clearTimeout(timer));}
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}

for(const signal of ['SIGTERM','SIGINT'])test(`production launcher cancels pending restart and exits promptly on ${signal}`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-stop-')),database=join(dir,'unused.sqlite'),marker=join(dir,'starts.txt');
 let child,closed;
 try{
  for(const folder of ['scripts','server','dist'])mkdirSync(join(dir,folder));
  cpSync(join(root,'scripts','start.mjs'),join(dir,'scripts','start.mjs'));
  for(const name of ['runtime.mjs','instance-profile.mjs'])cpSync(join(root,'server',name),join(dir,'server',name));
  writeFileSync(join(dir,'dist','index.html'),'<main>Fixture only</main>');
  // Exercise the real launcher and real backoff timers; only its child service
  // is a deliberate failure fixture. No database or external network is used.
  writeFileSync(join(dir,'server','index.mjs'),`import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(marker)},'started\\n');process.exit(41);`);
  const frontendPort=await freePort();let apiPort=await freePort();while(apiPort===frontendPort)apiPort=await freePort();
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('SIGNAL_'))delete env[key];
  Object.assign(env,{SIGNAL_DB_PATH:database,SIGNAL_FRONTEND_PORT:String(frontendPort),SIGNAL_API_PORT:String(apiPort)});
  child=spawn(process.execPath,[join(dir,'scripts','start.mjs'),'demo','--production'],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
  let output='',spawnError;child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',error=>spawnError=error);
  closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const deadline=Date.now()+12000;
  while(!output.includes('4000ms 后恢复，第 3/5 次')&&!spawnError&&child.exitCode===null&&Date.now()<deadline)await pause(10);
  assert.ifError(spawnError);assert.match(output,/4000ms 后恢复，第 3\/5 次/,'must reach the actual four-second restart delay: '+output);
  assert.equal(readFileSync(marker,'utf8').trim().split('\n').length,3);
  const started=performance.now();assert.equal(child.kill(signal),true);const result=await within(closed,6000),elapsed=performance.now()-started;
  assert.ok(result,'launcher failed to stop');assert.equal(result.code,0);
  assert.ok(elapsed<2000,`stopping with no live children must not wait out the restart delay; took ${Math.round(elapsed)}ms`);
  assert.equal(readFileSync(marker,'utf8').trim().split('\n').length,3,'no fourth child may start after stopping');
  assert.equal(existsSync(database),false);
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');if(closed)await closed;rmSync(dir,{recursive:true,force:true});
 }
});
