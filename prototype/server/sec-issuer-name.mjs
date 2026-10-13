// Call only after the exact ticker, official endpoint and CIK have been checked.
// This is a bounded spelling rule, not an issuer lookup or a company alias list.
export function secIssuerNameMatch(mappingName,reportedName){
 if(typeof mappingName!=='string'||typeof reportedName!=='string'||!mappingName.trim()||!reportedName.trim()||mappingName.length>160||reportedName.length>160)throw Error('SEC发行人名称无效');
 if(mappingName===reportedName)return null; // Preserve every accepted /1 material byte for byte.
 const suffix=name=>/^(.+\S) (CORP\.?|CORPORATION)$/.exec(name);
 const left=suffix(mappingName),right=suffix(reportedName);
 if(left&&right&&left[1]===right[1])return {schema:'sec-issuer-name/1',rule:'terminal-corp-corporation',mappingName,reportedName,commonStem:left[1]};
 // Only ASCII letter case changes. Do not normalize Unicode, whitespace,
 // jurisdiction suffixes, punctuation or corporate/parent/subsidiary names.
 const fold=name=>name.replace(/[a-z]/g,c=>c.toUpperCase()),a=fold(mappingName),b=fold(reportedName);
 if(a===b)return {schema:'sec-issuer-name/2',rule:'ascii-case-only',mappingName,reportedName,commonName:a};
 const ca=suffix(a),cb=suffix(b);
 if(ca&&cb&&ca[1]===cb[1])return {schema:'sec-issuer-name/2',rule:'ascii-case-and-terminal-corp-corporation',mappingName,reportedName,commonStem:ca[1]};
 throw Error('SEC发行人名称不一致；仅接受ASCII大小写及相同主体名称的CORP/CORPORATION后缀差异');
}
export const secIssuerNameNote=match=>match?.schema==='sec-issuer-name/2'?`发行人名称核对：证券映射“${match.mappingName}”；本响应“${match.reportedName}”；相同CIK及主体名称，仅ASCII字母大小写${match.rule==='ascii-case-only'?'':'与法定后缀CORP/CORPORATION写法'}不同（${match.schema}）。`:match?`发行人名称核对：证券映射“${match.mappingName}”；本响应“${match.reportedName}”；相同CIK及主体名称，仅法定后缀CORP/CORPORATION写法不同（${match.schema}）。`:null;
