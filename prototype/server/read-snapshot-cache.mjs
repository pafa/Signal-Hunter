import {serialize} from 'node:v8';
// Reuse expensive read projections only while this connection and other SQLite
// connections have made no committed changes. Never populate or consult the
// cache inside a transaction: a rollback must not publish uncommitted views.
export function readSnapshotCache(db,{limit=64,maxBytes=Infinity}={}){
 const changes=db.prepare('SELECT total_changes() AS n'),data=db.prepare('PRAGMA data_version'),schema=db.prepare('PRAGMA schema_version');
 const stamp=()=>`${changes.get().n}:${data.get().data_version}:${schema.get().schema_version}`;
 let generation=null,bytes=0;const entries=new Map();
 return (key,read)=>{
  if(db.isTransaction!==false)return read();
  const before=stamp();if(before!==generation){entries.clear();bytes=0;generation=before;}
  if(entries.has(key))return structuredClone(entries.get(key).value);
  const value=read();
  if(db.isTransaction===false&&stamp()===before){
   const size=Number.isFinite(maxBytes)?serialize(value).byteLength:0;
   if(size>maxBytes)return value;
   while(entries.size&&(entries.size>=limit||bytes+size>maxBytes)){const oldest=entries.keys().next().value;bytes-=entries.get(oldest).size;entries.delete(oldest);}
   entries.set(key,{value:structuredClone(value),size});bytes+=size;
  }
  return value;
 };
}
