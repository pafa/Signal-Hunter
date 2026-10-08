// Reuse expensive read projections only while this connection and other SQLite
// connections have made no committed changes. Never populate or consult the
// cache inside a transaction: a rollback must not publish uncommitted views.
export function readSnapshotCache(db,{limit=64}={}){
 const changes=db.prepare('SELECT total_changes() AS n'),data=db.prepare('PRAGMA data_version'),schema=db.prepare('PRAGMA schema_version');
 const stamp=()=>`${changes.get().n}:${data.get().data_version}:${schema.get().schema_version}`;
 let generation=null;const entries=new Map();
 return (key,read)=>{
  if(db.isTransaction!==false)return read();
  const before=stamp();if(before!==generation){entries.clear();generation=before;}
  if(entries.has(key))return structuredClone(entries.get(key));
  const value=read();
  if(db.isTransaction===false&&stamp()===before){
   if(entries.size>=limit)entries.delete(entries.keys().next().value);
   entries.set(key,structuredClone(value));
  }
  return value;
 };
}
