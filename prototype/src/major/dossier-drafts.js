const memory=new Map();
export const dossierDraftKey=topic=>`signal-hunter:dossier-draft:v1:${topic.id}:${topic.createdAt||''}`;
export function normalizeDossierDraft(value){
 return {...value,sections:(value.sections||[]).map(s=>({...s,paragraphs:Array.isArray(s.paragraphs)?s.paragraphs:[''],sourceIds:Array.isArray(s.sourceIds)?s.sourceIds:[]}))};
}
export function readDossierDraft(key,fallback,storage){
 let draft=memory.get(key);
 if(!draft){try{const stored=JSON.parse(storage?.getItem(key)||'null');if(stored&&Number.isSafeInteger(stored.base)&&Array.isArray(stored.sections)&&typeof stored.reason==='string'&&['draft','complete'].includes(stored.status))draft=stored;}catch{}}
 return normalizeDossierDraft(draft||fallback);
}
export function writeDossierDraft(key,value,storage){
 const draft=normalizeDossierDraft(value);memory.set(key,draft);
 try{if(!storage)return false;storage.setItem(key,JSON.stringify(draft));return true;}catch{return false;}
}
export function clearDossierDraft(key,storage){memory.delete(key);try{storage?.removeItem(key);}catch{}}
