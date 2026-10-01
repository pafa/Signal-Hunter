const str=(v,name,max=3000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`${name}无效`);return v.trim();};
const rows=(v,name,max)=>{if(!Array.isArray(v)||!v.length||v.length>max)throw new Error(`${name}无效`);return v;};
export function validateDossierSections(value,evidence){
 const sections=rows(value,'研判章节',20).map(s=>{
  if(!s||typeof s!=='object'||Array.isArray(s))throw new Error('研判章节无效');
  const sourceIds=s.sourceIds??[];
  if(!Array.isArray(sourceIds)||sourceIds.length>40||new Set(sourceIds).size!==sourceIds.length||sourceIds.some(id=>!evidence.some(e=>e.id===id)))throw new Error('研判引用不存在或重复');
  const out={id:str(s.id,'章节ID',80),title:str(s.title,'章节标题',160),paragraphs:rows(s.paragraphs,'研判段落',15).map(p=>str(p,'研判段落')),sourceIds:[...sourceIds]};
  if(s.table){const columns=rows(s.table.columns,'表头',6).map(c=>str(c,'表头',120));out.table={columns,rows:rows(s.table.rows,'表格行',20).map(r=>{if(!Array.isArray(r)||r.length!==columns.length)throw new Error('表格列数不符');return r.map(c=>str(c,'单元格',1800));})};}
  return out;
 });
 if(new Set(sections.map(s=>s.id)).size!==sections.length)throw new Error('章节ID重复');
 return sections;
}
