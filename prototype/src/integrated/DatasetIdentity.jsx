import React from 'react';
export default function DatasetIdentity({runtime,count=0}){
 if(!runtime)return null;
 const instance=runtime.instance;
 return <aside className="dataset-identity" aria-label="当前数据集"><strong>{runtime.offline?'演示数据':runtime.mode==='research'?'研究数据':'原有数据'} · {instance?.label||'工作台'}</strong><span>{count} 个研究主题 · {instance?.fixed?'已固定入口':'入口尚未固定'}</span>{instance&&<small>{instance.databaseName} · {instance.id.slice(0,8)}</small>}</aside>;
}
