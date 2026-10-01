const key='signal-hunter-research-context-v1';
export function normalizeContext(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))value={};
 return {range:[1,3,6].includes(value.range)?value.range:3,view:['grid','compare','table'].includes(value.view)?value.view:'grid',scope:value.scope==='all'?'all':'topic',
  picks:Array.isArray(value.picks)?[...new Set(value.picks.filter(s=>typeof s==='string'&&/^[A-Z0-9.-]{1,20}$/.test(s)))].slice(0,6):[],symbol:typeof value.symbol==='string'?value.symbol.slice(0,20):''};
}
export function researchContexts(){try{const x=JSON.parse(sessionStorage.getItem(key)||'[]');return Array.isArray(x)?x.filter(r=>r&&typeof r.id==='string').slice(-12):[];}catch{return [];}}
export function readResearchContext(id){return normalizeContext(researchContexts().find(r=>r.id===id)?.context);}
export function saveResearchContext(id,context){if(!id)return;try{sessionStorage.setItem(key,JSON.stringify([...researchContexts().filter(r=>r.id!==id),{id,context:normalizeContext(context)}].slice(-12)));}catch{/* Navigation still works when browser storage is disabled. */}}
