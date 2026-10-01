const memory=new Map(),listeners=new Map(),confirmed=new Map();
export const dossierDraftKey=topic=>`signal-hunter:dossier-draft:v1:${topic.id}:${topic.createdAt||''}`;
export function normalizeDossierDraft(value){
 return {...value,generation:Number.isSafeInteger(value.generation)?value.generation:0,sections:(value.sections||[]).map(s=>({...s,paragraphs:Array.isArray(s.paragraphs)?s.paragraphs:[''],sourceIds:Array.isArray(s.sourceIds)?s.sourceIds:[]}))};
}
const notify=(key,result)=>{for(const callback of listeners.get(key)||[])callback(result);};
export function subscribeDossierDraft(key,callback){const set=listeners.get(key)||new Set();set.add(callback);listeners.set(key,set);return ()=>{set.delete(callback);if(!set.size)listeners.delete(key);};}
export function readDossierDraft(key,fallback,storage){
 let draft=memory.get(key);
 if(!draft){try{const stored=JSON.parse(storage?.getItem(key)||'null');if(stored&&Number.isSafeInteger(stored.base)&&Array.isArray(stored.sections)&&typeof stored.reason==='string'&&['draft','complete'].includes(stored.status))draft=stored;}catch{}}
 const result=normalizeDossierDraft(draft||fallback);memory.set(key,result);return result;
}
export function persistDossierDraft(key,value,storage){
 const draft=normalizeDossierDraft({...value,generation:(memory.get(key)?.generation||value.generation||0)+1});memory.set(key,draft);
 let persisted=false;try{if(storage){storage.setItem(key,JSON.stringify(draft));persisted=true;}}catch{}
 const result={draft,persisted,saved:false,volatile:!persisted};notify(key,result);return result;
}
export const writeDossierDraft=(key,value,storage)=>persistDossierDraft(key,value,storage).persisted;
export function clearDossierDraft(key,storage){memory.delete(key);try{storage?.removeItem(key);}catch{}}
// Only the exact submitted generation may be removed. A remounted editor receives
// the same acknowledgement; newer keystrokes stay pending and survive old replies.
export function acknowledgeDossierSave(key,submitted,newVersion,storage){
 if(confirmed.get(key)>=newVersion)return {ignored:true};
 confirmed.set(key,newVersion);
 const current=memory.get(key);
 if(current&&current.generation!==submitted.generation){
  const base=current.base===submitted.base&&newVersion===submitted.base+1?newVersion:current.base;
  const result={...persistDossierDraft(key,{...current,base},storage),saved:'newer-edits'};notify(key,result);return result;
 }
 const draft={...submitted,base:newVersion};clearDossierDraft(key,storage);
 const result={draft,saved:true,volatile:false,persisted:true};notify(key,result);return result;
}
