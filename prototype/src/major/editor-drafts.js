const memory=new Map(),listeners=new Map();
export const editorDraftKey=(topic,instance,kind)=>'signal-hunter:editor-draft:v1:'+JSON.stringify([instance,topic.id,topic.createdAt||'',kind]);
const notify=(key,value)=>{for(const f of listeners.get(key)||[])f(value);};
export function subscribeEditorDraft(key,fn){const set=listeners.get(key)||new Set();set.add(fn);listeners.set(key,set);return()=>{set.delete(fn);if(!set.size)listeners.delete(key);};}
export function readEditorDraft(key,initial,valid,storage){
 let draft=memory.get(key);if(!memory.has(key))try{const raw=storage?.getItem(key);if(raw&&raw.length<=262144){const d=JSON.parse(raw);if(Number.isSafeInteger(d.base)&&d.base>0&&Number.isSafeInteger(d.generation)&&d.generation>0&&d.dirty===true&&valid(d.value))draft=d;}}catch{}
 const result=draft?.dirty?draft:{base:initial.base,value:initial.value,generation:draft?.generation||0,dirty:false,volatile:false};memory.set(key,result);return result;
}
export function persistEditorDraft(key,current,value,storage,base=current.base){
 const draft={base,value,generation:(memory.get(key)?.generation||current.generation||0)+1,dirty:true,volatile:false};
 try{storage.setItem(key,JSON.stringify(draft));}catch{draft.volatile=true;}memory.set(key,draft);notify(key,draft);return draft;
}
export function resetEditorDraft(key,value,base,storage){
 const draft={base,value,generation:(memory.get(key)?.generation||0)+1,dirty:false,volatile:false};
 try{storage?.removeItem(key);}catch{draft.volatile=true;}memory.set(key,draft);notify(key,draft);return draft;
}
// A reply to an old form must never remove a newer draft, even after unmount/remount.
export function acknowledgeEditorDraft(key,submitted,value,base,storage){
 const current=memory.get(key);if(current&&current.generation!==submitted.generation)return {retained:true};
 resetEditorDraft(key,value,base,storage);return {retained:false};
}
