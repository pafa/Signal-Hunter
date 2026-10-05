const positive=value=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw Error('研究历史分页参数无效');return Number(value);};
export function researchHistoryPage(db,id,params={}){
 if(Object.keys(params).some(k=>!['limit','before','ceiling'].includes(k)))throw Error('研究历史分页参数无效');
 const latest=db.prepare('SELECT MAX(version) version FROM research_versions WHERE topic_id=?').get(id).version;
 if(!latest)throw Error('研究历史不存在');
 const limit=params.limit===undefined?25:positive(params.limit),ceiling=params.ceiling===undefined?latest:positive(params.ceiling),before=params.before===undefined?null:positive(params.before);
 if(limit>100||ceiling>latest||before!==null&&before>ceiling)throw Error('研究历史分页参数无效');
 const rows=db.prepare('SELECT version,recorded_at AS recordedAt,reason FROM research_versions WHERE topic_id=? AND version<=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?').all(id,ceiling,before,before,limit+1),items=rows.slice(0,limit);
 const total=db.prepare('SELECT COUNT(*) total FROM research_versions WHERE topic_id=? AND version<=?').get(id,ceiling).total;
 return {items,total,ceiling,latestVersion:latest,nextCursor:rows.length>limit?items.at(-1).version:null};
}
export function researchHistoryDetail(db,id,value){
 const version=positive(value),read=v=>db.prepare('SELECT version,recorded_at AS recordedAt,reason,payload FROM research_versions WHERE topic_id=? AND version=?').get(id,v),row=read(version);
 if(!row)throw Error('研究历史版本不存在');
 const topic=JSON.parse(row.payload);if(topic.id!==id||topic.version!==version)throw Error('研究历史版本不匹配');
 let previous=null;
 if(version>1){const prior=read(version-1);if(!prior)throw Error('相邻历史版本缺失，无法比较本版新增证据');previous=JSON.parse(prior.payload);if(previous.id!==id||previous.version!==version-1)throw Error('研究历史版本不匹配');}
 const oldIds=new Set(previous?.evidence.map(e=>e.id)||[]);
 return {version,recordedAt:row.recordedAt,reason:row.reason,topic,previousVersion:previous?.version??null,addedEvidenceIds:topic.evidence.filter(e=>!oldIds.has(e.id)).map(e=>e.id)};
}
