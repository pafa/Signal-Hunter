import {validParentConnection} from './company-ownership.mjs';
const normalized=v=>v.normalize('NFKC').trim().toLocaleLowerCase('en-US');
// An exact alias must identify one security in the frozen directory, including
// all A/H/ADR alternatives. This is a research association, never listing proof.
export function automaticIdentity(mention,directory){
 return automaticIdentityDecision(mention,directory).symbol;
}
export function automaticIdentityDecision(mention,directory,coverage={},packet=null){
 const result=(code,reason,symbol=null,matches=[])=>({schema:'automatic-identity-decision/1',code,reason,symbol,matches});
 if(mention.eventConnection&&mention.eventConnection.relation!=='direct'&&!validParentConnection(mention,packet))return result('not-direct','来源主体未与原事项建立直接关系，保留关系判断及原文');
 if(mention.entityType!=='company')return result('not-confirmed-company','原文主体未被识别为公司，保留主体类型与依据');
 const matches=directory.filter(c=>[c.name,...(c.aliases||[])].some(n=>normalized(n)===normalized(mention.name)));
 const symbols=matches.map(c=>c.symbol);
 if(mention.resolution==='ambiguous'||mention.symbols.length>1||matches.length>1)return result('ambiguous','名称或模型候选对应多个证券，保留市场歧义',null,symbols);
 if(!matches.length){
  const excluded=(coverage.excludedMatches||[]).filter(c=>[c.name,...(c.aliases||[])].some(n=>normalized(n)===normalized(mention.name))||c.symbol&&mention.symbols.includes(c.symbol));
  if(excluded.length)return result('directory-excluded','目录命中但证券类型或资格未确认，保留排除原因',null,excluded.map(c=>c.symbol).filter(Boolean));
  return result('no-exact-name','冻结目录没有与原文名称精确对应的有效候选，继续保留身份缺口');
 }
 if(mention.resolution!=='candidate'||mention.symbols.length!==1)return result('model-unresolved','目录有名称候选，但模型未确定证券身份，保留原判断',null,symbols);
 if(matches[0].symbol!==mention.symbols[0])return result('candidate-disagrees','模型选择与冻结目录的精确名称候选不一致，保留分歧',null,symbols);
 return result('unique-name','原文名称与冻结目录唯一对应；仍为待核实公司关联',symbols[0],symbols);
}
