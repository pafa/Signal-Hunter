// Read-only pagination lives outside screening-samples.mjs: changing a history
// view must not change the captured classifier source fingerprint.
export function screeningSamplePage(db,newsId,currentRulesHash,params={}){
 const bad=()=>{throw new Error('初筛留样分页参数无效');};
 if(!params||Object.keys(params).some(k=>!['before','ceiling'].includes(k)))bad();
 const {before,ceiling}=params,max=db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM screening_samples WHERE news_id=?').get(newsId).n;
 const upper=ceiling===undefined?max:Number(ceiling);
 if(ceiling!==undefined&&!/^\d+$/.test(String(ceiling))||!Number.isSafeInteger(upper)||upper<0||upper>max)bad();
 let cursor=null;
 if(before!==undefined){
  if(typeof before!=='string'||! /^[a-f0-9]{64}$/.test(before)||ceiling===undefined)bad();
  cursor=db.prepare('SELECT rowid,recorded_at FROM screening_samples WHERE news_id=? AND id=? AND rowid<=?').get(newsId,before,upper);
  if(!cursor)bad();
 }
 const total=db.prepare('SELECT COUNT(*) n FROM screening_samples WHERE news_id=? AND rowid<=?').get(newsId,upper).n;
 const rows=db.prepare('SELECT id,payload FROM screening_samples WHERE news_id=? AND rowid<=?'+(cursor?' AND (recorded_at<? OR (recorded_at=? AND rowid<?))':'')+' ORDER BY recorded_at DESC,rowid DESC LIMIT 13').all(newsId,upper,...(cursor?[cursor.recorded_at,cursor.recorded_at,cursor.rowid]:[]));
 const samples=rows.slice(0,12).map(r=>({...JSON.parse(r.payload),reviews:db.prepare('SELECT payload FROM screening_reviews WHERE sample_id=? ORDER BY version DESC').all(r.id).map(v=>JSON.parse(v.payload))}));
 return {samples,currentRulesHash,total,ceiling:upper,nextCursor:rows.length>12?rows[11].id:null};
}
