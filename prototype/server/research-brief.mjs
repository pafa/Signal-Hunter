import {instrument,hash} from './providers.mjs';
import {validateAssessment} from '../shared/uncertainty.mjs';

const str=(v,name,max=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`${name}无效`);return v.trim();};
const list=(v,name,max)=>{if(!Array.isArray(v)||!v.length||v.length>max)throw new Error(`${name}无效`);return v;};
const date=v=>{str(v,'日期',40);if(!Number.isFinite(Date.parse(v)))throw new Error('日期无效');return v;};
const url=v=>{const u=new URL(str(v,'来源链接'));if(u.protocol!=='https:'||u.username||u.password)throw new Error('来源需为无凭据的 HTTPS 链接');return u.href;};
const unique=(rows,key)=>{if(new Set(rows.map(r=>r[key])).size!==rows.length)throw new Error(`${key}重复`);return rows;};

// Local, analyst-authored content import; external news cannot invoke this as an instruction.
export function validateResearchBrief(data,now){
 const id=str(data.id,'研判 ID',100);if(!/^attachment-[a-z0-9-]+$/.test(id))throw new Error('附件研判 ID 无效');
 const a=data.attachment;if(!a||!/^[a-f0-9]{64}$/.test(a.sha256))throw new Error('缺少附件指纹');
 const attachment={fileName:str(a.fileName,'附件名',200),sha256:a.sha256,windowStart:date(a.windowStart),windowEnd:date(a.windowEnd)};
 if(Date.parse(attachment.windowStart)>=Date.parse(attachment.windowEnd)||Date.parse(attachment.windowEnd)>Date.parse(now))throw new Error('附件时间窗口无效');
 const chain=unique(list(data.chain,'因果链',8).map(s=>({id:str(s.id,'环节',80),title:str(s.title,'环节标题',120),question:str(s.question,'环节问题')})),'id');
 const companies=unique(list(data.companies,'关联公司',20).map(c=>({symbol:instrument(c.symbol).symbol,name:str(c.name,'公司名称',120),role:str(c.role,'公司作用',160),note:str(c.note,'关联解释'),url:c.url?url(c.url):''})),'symbol');
 const evidence=unique(list(data.evidence,'证据',40).map(e=>{
  if(!['primary','reported','unverified'].includes(e.verification)||!['supports','against','context','unverified'].includes(e.stance)||!['adoption','mechanism','ecosystem','constraint','supply','purchase','earnings','corporate','other'].includes(e.family)||!chain.some(s=>s.id===e.step))throw new Error('证据分类无效');
  const publishedAt=e.publishedAt?date(e.publishedAt):null;if(publishedAt&&Date.parse(publishedAt)>Date.parse(now))throw new Error('证据发布日期在未来');
  return {id:str(e.id,'证据 ID',100),claim:str(e.claim,'证据内容',1200),sourceName:str(e.sourceName,'来源名称',180),url:url(e.url),originKey:str(e.originKey,'来源主体',180),verification:e.verification,stance:e.stance,family:e.family,step:e.step,interpretation:str(e.interpretation,'关联解释'),publishedAt,datePrecision:publishedAt?.includes('T')?'instant':'day',firstSeen:now,addedAt:now,retrospective:true,contentScope:'analyst-paraphrase',review:{at:now,by:'research-assistant',note:'研究助手核对可访问出处；媒体陈述不等于未来结果已证实'}};
 }),'id');
 const assessment=validateAssessment(data.assessment);
 const hypothesis={action:'observe'};for(const key of ['logic','trigger','invalidation','industryHorizon','holdingHorizon','reviewAt'])hypothesis[key]=str(data.hypothesis?.[key],key);
 if(data.hypothesis.action!=='observe'||!/^\d{4}-\d{2}-\d{2}$/.test(hypothesis.reviewAt)||new Date(hypothesis.reviewAt+'T00:00:00Z').toISOString().slice(0,10)!==hypothesis.reviewAt)throw new Error('附件导入仅建立观察研究，复核日期必须有效');
 const sections=unique(list(data.dossier?.sections,'详细研判',20).map(s=>{
  const sourceIds=(s.sourceIds||[]).map(id=>{if(!evidence.some(e=>e.id===id))throw new Error('研判引用不存在');return id;});
  const section={id:str(s.id,'章节 ID',80),title:str(s.title,'章节标题',160),paragraphs:list(s.paragraphs,'研判段落',15).map(p=>str(p,'段落',3000)),sourceIds};
  if(s.table){const columns=list(s.table.columns,'表头',6).map(c=>str(c,'表头',120));section.table={columns,rows:list(s.table.rows,'表格行',20).map(r=>{if(!Array.isArray(r)||r.length!==columns.length)throw new Error('研判表格列数不符');return r.map(c=>str(c,'单元格',1800));})};}
  return section;
 }),'id');
 const eventPublishedAt=date(data.eventPublishedAt);if(Date.parse(eventPublishedAt)>Date.parse(now))throw new Error('事件日期在未来');
 return {id,title:str(data.title,'标题',140),summary:str(data.summary,'摘要'),label:str(data.label,'类别',80),origin:'attachment-research',type:'event',status:'active',createdAt:now,firstSeen:now,eventPublishedAt,eventTimeBasis:str(data.eventTimeBasis,'事件时间口径'),attachment,chain,companies,evidence,hypothesis,nextEvidence:str(data.nextEvidence,'下一证据'),assessment:{...assessment,assessedAt:now,method:'subjective-analyst'},dossier:{preparedAt:now,preparedBy:'研究助手 · 本轮人工式研究，非自动模型输出',basedOnResearchVersion:1,sections},importHash:hash(JSON.stringify(data))};
}
