import {sourceQuantities} from '../shared/source-quantities.mjs';

const fields=['title','actor','action','object','stage','boundaryReason'];
const quantityKey=q=>q.normalization==='literal-only'?JSON.stringify([q.unit,q.normalizedValue]):q.normalization==='ambiguous-currency'?JSON.stringify(['verbatim',q.raw]):null;
// A number elsewhere in the document is not support for this occurrence.
// Inspect full-source context, including signs and ranges outside the quote.
function quotedQuantities(material,event){
 const source=material[event.quoteField],quantities=sourceQuantities(source);let shared=null,first=0;
 for(let start=source.indexOf(event.quote);start!==-1;start=source.indexOf(event.quote,start+1)){
  while(first<quantities.length&&quantities[first].start<start)first++;
  const keys=new Set(),end=start+event.quote.length;
  for(let i=first;i<quantities.length&&quantities[i].start<end;i++)if(quantities[i].end<=end){const key=quantityKey(quantities[i]);if(key!==null)keys.add(key);}
  shared=shared===null?keys:new Set([...shared].filter(key=>keys.has(key)));
  if(!shared.size)return shared;
 }
 return shared||new Set();
}
export function groundMaterialEventQuantities(output,material){
 const result=structuredClone(output),changed=[];
 for(const [index,event] of result.events.entries()){
  const occurrences=quotedQuantities(material,event),changedFields=[];
  for(const field of fields){
   const text=event[field],unsupported=sourceQuantities(text).filter(q=>!occurrences.has(quantityKey(q)));
   if(!unsupported.length)continue;
   const replace=compact=>{let value=text;for(const q of unsupported.toReversed())value=value.slice(0,q.start)+(compact?'待核':q.unit==='percent'?'〔比例待核〕':'〔金额待核〕')+value.slice(q.end);return value;};
   event[field]=replace(false);
   if(event[field].length>(field==='title'?140:1000))event[field]=replace(true);
   changedFields.push(field);
  }
  if(changedFields.length)changed.push(`事项${index+1}（${changedFields.join('、')}）`);
 }
 // Derived diagnostic may be the 21st item; the model's 20 original gaps survive.
 // Raw model output stays unchanged and this versioned projection is recomputable.
 if(changed.length)result.missingEvidence.unshift(`来源数值校验：${changed.join('；')}含未由对应完整引文支持的金额或比例，已标为待核，继续研究。原模型输出保留；此检查仅核对可解析的数值与单位，不代表主体、会计含义或投资判断已验证。`);
 return result;
}
