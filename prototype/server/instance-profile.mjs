import {readFileSync,writeFileSync,realpathSync,statSync} from 'node:fs';
import {isAbsolute,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const hash=value=>createHash('sha256').update(value).digest('hex');
const modes=['demo','research','legacy'];
const port=value=>Number.isInteger(value)&&value>=1024&&value<=65535;
function validate(profile){
 if(!profile||profile.format!==1||typeof profile.id!=='string'||!/^[-a-z0-9]{36}$/.test(profile.id)||typeof profile.label!=='string'||!profile.label.trim()||profile.label.length>80||/[\x00-\x1f\x7f]/.test(profile.label)||!modes.includes(profile.mode)||typeof profile.database!=='string'||!isAbsolute(profile.database)||!port(profile.frontendPort)||!port(profile.apiPort)||profile.frontendPort===profile.apiPort)throw new Error('实例配置无效');
 const a=profile.anchor;
 if(!a||!['research_versions','paper_versions'].includes(a.table)||!Number.isSafeInteger(a.version)||a.version<1||!/^([a-f0-9]{64})$/.test(a.sha256)||a.table==='research_versions'&&(typeof a.topicId!=='string'||!a.topicId))throw new Error('实例历史指纹无效');
 return profile;
}
export function readInstanceProfile(path){
 if(!isAbsolute(path)||statSync(path).size>8192)throw new Error('实例配置必须为不超过 8 KiB 的绝对文件路径');
 return validate(JSON.parse(readFileSync(path,'utf8')));
}
export function verifyInstanceDatabase(profile){
 validate(profile);
 // readOnly rejects missing paths and cannot create or migrate the source database.
 const db=new DatabaseSync(profile.database,{readOnly:true});
 try{
  if(db.prepare("SELECT value FROM settings WHERE key='runtime_mode'").get()?.value!==profile.mode)throw new Error('实例配置与数据库模式不符');
  const a=profile.anchor,row=a.table==='research_versions'?db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version=?').get(a.topicId,a.version):db.prepare('SELECT payload FROM paper_versions WHERE version=?').get(a.version);
  if(!row||hash(row.payload)!==a.sha256)throw new Error('实例历史指纹不符，拒绝打开其他数据集');
 }finally{db.close();}
}
export function registerInstance({database,output,label,frontendPort=4178,apiPort=4179}){
 if(!isAbsolute(database)||!isAbsolute(output)||!output.endsWith('.instance.json'))throw new Error('数据库和新配置必须为绝对路径，配置以 .instance.json 结尾');
 const path=realpathSync(database),db=new DatabaseSync(path,{readOnly:true});let mode,anchor;
 try{
  mode=db.prepare("SELECT value FROM settings WHERE key='runtime_mode'").get()?.value;
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const research=tables.has('research_versions')&&db.prepare('SELECT topic_id,version,payload FROM research_versions ORDER BY recorded_at,topic_id,version LIMIT 1').get();
  const paper=!research&&tables.has('paper_versions')&&db.prepare('SELECT version,payload FROM paper_versions ORDER BY version LIMIT 1').get();
  if(research)anchor={table:'research_versions',topicId:research.topic_id,version:research.version,sha256:hash(research.payload)};
  else if(paper)anchor={table:'paper_versions',version:paper.version,sha256:hash(paper.payload)};
  else throw new Error('数据库缺少可核对的历史版本，请先完成初始化');
 }finally{db.close();}
 const profile=validate({format:1,id:randomUUID(),label,mode,database:path,frontendPort,apiPort,anchor});
 verifyInstanceDatabase(profile);
 writeFileSync(output,JSON.stringify(profile,null,2)+'\n',{flag:'wx',mode:0o600});return profile;
}
export function instanceIdentity(dbPath,mode,profile=null){
 if(profile)return {id:profile.id,label:profile.label,fixed:true,databaseName:basename(profile.database)};
 return {id:hash(dbPath),label:{demo:'离线演示',research:'研究工作台',legacy:'原有工作台'}[mode],fixed:false,databaseName:basename(dbPath)};
}
