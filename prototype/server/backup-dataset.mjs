import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
// Only immutable history anchors identify a data set; names and paths do not.
export function backupDataset(path){
 const db=new DatabaseSync(path,{readOnly:true});try{
  const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));if(!names.has('settings'))return null;
  let row=names.has('research_versions')?db.prepare('SELECT topic_id,version,payload FROM research_versions ORDER BY recorded_at,topic_id,version LIMIT 1').get():null,kind='research';
  if(!row&&names.has('paper_versions')){row=db.prepare('SELECT version,payload FROM paper_versions ORDER BY version LIMIT 1').get();kind='paper';}
  if(!row)return null;return {mode:db.prepare("SELECT value FROM settings WHERE key='runtime_mode'").get()?.value||'legacy',kind,topicId:row.topic_id||null,version:row.version,hash:createHash('sha256').update(row.payload).digest('hex')};
 }catch{return null;}finally{db.close();}
}
