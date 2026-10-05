const memory=new Map();
const validForm=form=>form&&typeof form.symbol==='string'&&typeof form.note==='string'&&Array.isArray(form.materiality)&&form.materiality.length<=8&&form.materiality.every(row=>row&&['id','label','scope','period','unit','basis'].every(k=>typeof row[k]==='string')&&['baseline','affected','expected','observed'].every(k=>row[k]==null||typeof row[k].value==='number'&&Array.isArray(row[k].evidenceIds)));
export const companyDraftKey=(topic,instance,symbol)=>`signal-hunter:company-draft:v1:${instance}:${topic.id}:${topic.createdAt||''}:${symbol||'new'}`;
export function readCompanyDraft(key,storage){
 if(memory.has(key))return memory.get(key);
 try{const value=JSON.parse(storage?.getItem(key)||'null');if(value&&Number.isSafeInteger(value.base)&&value.base>0&&validForm(value.form)&&typeof value.editing==='boolean'){memory.set(key,value);return value;}}catch{}
 return null;
}
export function writeCompanyDraft(key,value,storage){memory.set(key,value);try{storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
export function clearCompanyDraft(key,storage){memory.delete(key);try{storage?.removeItem(key);}catch{}}
