import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function runtimeConfig(env=process.env) {
 const mode=env.SIGNAL_MODE||'legacy';
 if(!['legacy','demo','research'].includes(mode))throw new Error('SIGNAL_MODE 只能为 demo、research 或 legacy');
 const port=(name,fallback)=>{const n=Number(env[name]||fallback);if(!Number.isInteger(n)||n<1024||n>65535)throw new Error(`${name} 必须为 1024–65535 的端口`);return n;};
 const apiPort=port('SIGNAL_API_PORT',4179),frontendPort=port('SIGNAL_FRONTEND_PORT',4178);
 if(apiPort===frontendPort)throw new Error('网页与 API 必须使用不同端口');
 const filename={legacy:'workbench.sqlite',demo:'demo.sqlite',research:'research.sqlite'}[mode];
 const production=env.SIGNAL_SERVE_STATIC==='1';
 return {mode,apiPort,frontendPort,production,dbPath:resolve(env.SIGNAL_DB_PATH||fileURLToPath(new URL(`../../data/runtime/${filename}`,import.meta.url)))};
}

export function assertDatabaseMode(store,mode,{persist=true}={}) {
 const row=store.db.prepare("SELECT value FROM settings WHERE key='runtime_mode'").get();
 if(row&&row.value!==mode)throw new Error(`数据库已用于 ${row.value} 模式，拒绝作为 ${mode} 打开；请使用另一个数据库路径`);
 if(row)return;
 // Unmarked existing databases belong to the legacy workbench. Never seed over them.
 const hasData=store.db.prepare('SELECT COUNT(*) n FROM news').get().n||store.db.prepare('SELECT COUNT(*) n FROM watches').get().n||store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('research_topics','paper_books')").get();
 if(hasData&&mode!=='legacy')throw new Error('未标记的旧数据库不能用于新模式；请使用空的新路径');
 if(persist)store.db.prepare('INSERT INTO settings VALUES (?,?)').run('runtime_mode',mode);
}

// Validate before openStore performs schema initialization. A mistaken path must not migrate a private DB.
export function checkDatabaseFile({dbPath,mode}) {
 if(!existsSync(dbPath))return;
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  const settings=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get();
  if(!settings)throw new Error('已有文件不是已识别的工作台数据库；请使用新的数据库路径');
  assertDatabaseMode({db},mode,{persist:false});
 }finally{db.close();}
}
