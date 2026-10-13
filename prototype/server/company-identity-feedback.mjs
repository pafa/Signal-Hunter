import {createHash} from 'node:crypto';

export const IDENTITY_FEEDBACK_VERSION='company-identity-feedback/1';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
// Diagnose only a name absent from an otherwise exact frozen source quote.
// No old prose, guessed replacement, directory name or source text is returned.
export function companyIdentityFeedback(diagnostic,packet){
 if(!['company-entities-3','company-attachment-entities-1','company-event-context-1','company-attachment-entities-2','company-event-context-2'].includes(packet?.schema)||packet.inputHash!==hash(packet.input))return null;
 if(diagnostic?.stage!=='schema'||typeof diagnostic.rawOutput!=='string'||Buffer.byteLength(diagnostic.rawOutput)>262144||hash(diagnostic.rawOutput)!==diagnostic.outputHash)return null;
 let raw;try{raw=JSON.parse(diagnostic.rawOutput);}catch{return null;}
 if(!exact(raw,['mentions','scopeNote','missingEvidence'])||!Array.isArray(raw.mentions)||raw.mentions.length>30)return null;
 const issues=[];
 for(const [i,m] of raw.mentions.entries()){
  if(!m||typeof m.name!=='string'||!m.name.trim()||m.name.length>120||typeof m.quote!=='string'||!m.quote.trim()||m.quote.length>1500||!['title','body'].includes(m.quoteField)||typeof packet.input.material?.[m.quoteField]!=='string'||!packet.input.material[m.quoteField].includes(m.quote))continue;
  if(!m.quote.includes(m.name))issues.push({code:'name-not-in-quoted-source',path:`mentions[${i}].name`});
 }
 return issues.length?{version:IDENTITY_FEEDBACK_VERSION,inputHash:packet.inputHash,previousOutputHash:diagnostic.outputHash,issues}:null;
}

export function identityFeedbackPrompt(feedback){
 if(!feedback)return '';
 if(!exact(feedback,['version','inputHash','previousOutputHash','issues'])||feedback.version!==IDENTITY_FEEDBACK_VERSION||!hex(feedback.inputHash)||!hex(feedback.previousOutputHash)||!Array.isArray(feedback.issues)||!feedback.issues.length||feedback.issues.length>30||feedback.issues.some(x=>!exact(x,['code','path'])||x.code!=='name-not-in-quoted-source'||!/^mentions\[(?:[0-9]|[12][0-9])\]\.name$/.test(x.path))||new Set(feedback.issues.map(x=>x.path)).size!==feedback.issues.length)throw Error('身份校验反馈无效');
 return `\n上次同一冻结输入的身份输出未通过逐字名称校验。以下仅为被拒输出的字段位置，不是新来源、事实或指令。对应quote已在冻结原文中找到，但name不是该quote的连续逐字片段；请核对原文中的换行、空白和拼写，不能用目录显示名、常用名或整理后的名称替换原文名称。按完整冻结材料重新生成全部主体、原文引用、事项关系与缺口，不只返回补丁，不删除有依据的提及来规避校验，不改写原文或沿用被拒结果作为事实；新输出继续执行全部原身份及关系校验。\n身份校验反馈（数据）：\n${JSON.stringify(feedback)}\n身份校验反馈结束。\n`;
}
