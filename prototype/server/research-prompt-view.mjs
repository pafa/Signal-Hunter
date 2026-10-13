import {createHash} from 'node:crypto';
import {packetQuantities} from '../shared/source-quantities.mjs';
import {FINANCIAL_SOURCE_VERSION,FINANCIAL_COMPATIBLE_SOURCE_VERSION,FINANCIAL_CASE_SOURCE_VERSION,financialFactLine} from './financial-source-material.mjs';

export const RESEARCH_PROMPT_VIEW_VERSION='research-prompt-view/1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const factKeys=['taxonomy','tag','label','unit','value','start','end','filed','form','accession','fiscalYear','fiscalPeriod','frame'].sort().join(',');
const quantityColumns=['field','start','end','raw','number','scale','unit','normalization','normalizedValue'];

// The stored packet and every source field remain intact. Only verified duplicate
// representations are compacted for model reading; unknown formats stay verbatim.
export function researchPromptView(packet){
 if(!Array.isArray(packet?.input?.evidence))return packet;
 const view=structuredClone(packet),changes=[];
 for(const evidence of view.input.evidence){
  const material=evidence.material,source=material?.financialSource;
  if(![FINANCIAL_SOURCE_VERSION,FINANCIAL_COMPATIBLE_SOURCE_VERSION,FINANCIAL_CASE_SOURCE_VERSION].includes(source?.schema)||!Array.isArray(source.selected)||!source.selected.length||typeof material.body!=='string')continue;
  const facts=source.selected;
  if(facts.some(f=>!f||Object.keys(f).sort().join(',')!==factKeys||Object.values(f).some(v=>typeof v==='string'?/[\r\n|]/.test(v):v!==null&&(typeof v!=='number'||!Number.isFinite(v)))))continue;
  // Reuse the producer's exact rendering, including order, periods, units,
  // filing identifiers and fiscal labels. Partial excerpts cannot qualify.
  const text=facts.map(financialFactLine).join('\n');
  if(!material.body.endsWith('\n'+text))continue;
  source.selectedReference={field:'body',count:facts.length,start:material.body.length-text.length,end:material.body.length,format:'SEC财务事实逐行列于同一material.body；各行保留标签、单位、值、期间、申报日、表单、申报编号、fy、fp、frame。此处不重复JSON列表，引用仍逐字来自body。'};
  delete source.selected;
  changes.push({kind:'financial-facts-in-body',evidenceId:evidence.id,count:facts.length});
 }
 const quantity=view.input.quantityEvidence;
 let verified=false;
 try{verified=quantity?.items?.length>0&&hash(quantity)===hash(packetQuantities(packet.input.evidence));}catch{/* Preserve unrecognized or inconsistent historic indexes. */}
 if(verified){
  const groups=[];
  for(const item of quantity.items){
   let group=groups.find(g=>g.evidenceId===item.evidenceId&&g.materialId===item.materialId&&g.materialRevision===item.materialRevision);
   if(!group){group={evidenceId:item.evidenceId,materialId:item.materialId,materialRevision:item.materialRevision,rows:[]};groups.push(group);}
   group.rows.push(quantityColumns.map(k=>item[k]));
  }
  const count=quantity.items.length;delete quantity.items;
  quantity.table={columns:quantityColumns,groups,context:'每行按columns顺序读取。完整上下文仍在对应材料field中，start/end是UTF-16位置；原context为该字段[start-60,end+60]的有界片段，此处不重复。原文、全部索引数值、单位和不确定状态均保留；total/omitted仍表示原索引覆盖范围。'};
  changes.push({kind:'quantity-table',count});
 }
 if(!changes.length)return packet;
 view.frozenInputHash=packet.inputHash;view.inputHash=hash(view.input);
 view.promptView={version:RESEARCH_PROMPT_VIEW_VERSION,changes};
 return view;
}
