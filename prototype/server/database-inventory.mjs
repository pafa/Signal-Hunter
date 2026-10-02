import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const cell=value=>value===null?['null']:typeof value==='bigint'?['integer',String(value)]:value instanceof Uint8Array?['blob',Buffer.from(value).toString('hex')]:[typeof value,value];

// Hash every row, including duplicates, without exporting private row contents.
// The restore projection describes only the documented task/lease/review changes.
export function inventoryDatabase(path,{restoreProjection=false}={}){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  db.exec('BEGIN');
  if(db.prepare('PRAGMA integrity_check').all().some(r=>r.integrity_check!=='ok'))throw new Error('数据库完整性校验失败');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('数据库外键校验失败');
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables=Object.create(null);
  for(const item of schema.filter(r=>r.type==='table')){
   const name=item.name,columns=db.prepare(`PRAGMA table_xinfo(${quote(name)})`).all().map(c=>c.name);
   const query=db.prepare(`SELECT * FROM ${quote(name)}`);query.setReadBigInts(true);
   let records=query.all();
   if(restoreProjection){
    if(name==='settings'){records=records.filter(r=>r.key!=='restore_review_required');records.push({key:'restore_review_required',value:'1'});}
    if(name==='operation_tasks')records=records.map(r=>({...r,paused:1n,token:null,lease_until:null,state:'waiting'}));
    if(name==='operation_runs')records=records.map(r=>r.outcome==='running'?{...r,outcome:'interrupted'}:r);
   }
   const rows=records.map(r=>hash(columns.map(c=>cell(r[c])))).sort();
   tables[name]={columns,count:rows.length,sha256:hash(rows),rows};
  }
  db.exec('COMMIT');
  return {format:1,schemaHash:hash(schema),schema:Object.fromEntries(schema.map(r=>[r.type+':'+r.name,hash(r)])),tables};
 }finally{db.close();}
}
export function summarizeInventory(inventory){
 return {...inventory,tables:Object.fromEntries(Object.entries(inventory.tables).map(([name,{rows,...table}])=>[name,table]))};
}
export function compareInventories(before,after,{allowAdditions=false}={}){
 const tables=[];
 for(const name of [...new Set([...Object.keys(before.tables),...Object.keys(after.tables)])].sort()){
  const a=before.tables[name],b=after.tables[name];let removed=0,added=0;
  const counts=new Map();for(const row of a?.rows||[])counts.set(row,(counts.get(row)||0)+1);
  for(const row of b?.rows||[]){const n=counts.get(row)||0;if(n)counts.set(row,n-1);else added++;}
  for(const n of counts.values())removed+=n;
  tables.push({name,before:a?.count??null,after:b?.count??null,removed,added,columnsChanged:!!a&&!!b&&JSON.stringify(a.columns)!==JSON.stringify(b.columns),identical:!!a&&!!b&&a.sha256===b.sha256&&JSON.stringify(a.columns)===JSON.stringify(b.columns)});
 }
 const schemaRemovedOrChanged=Object.keys(before.schema).filter(key=>before.schema[key]!==after.schema[key]);
 const schemaAdded=Object.keys(after.schema).filter(key=>!Object.hasOwn(before.schema,key));
 const preserved=schemaRemovedOrChanged.length===0&&tables.every(t=>t.before===null||t.after!==null&&!t.columnsChanged&&t.removed===0);
 const identical=preserved&&schemaAdded.length===0&&tables.every(t=>t.identical);
 return {passed:allowAdditions?preserved:identical,identical,preserved,schemaRemovedOrChanged,schemaAdded,tables};
}
