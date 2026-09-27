export const CLAIM_STATES={unverified:'未证实',rumor:'传闻',confirmed:'已证实',denied:'已否认',partial:'部分证实'};
export function validateAssessment(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('概率评估格式无效');
 const keys=['status','claim','probability','basis','impactIfTrue','impactIfFalse','horizon','resolveBy'];
 if(Object.keys(value).some(k=>!keys.includes(k))||!Object.hasOwn(CLAIM_STATES,value.status))throw new Error('消息状态无效');
 if(value.probability!==null&&(!Number.isFinite(value.probability)||value.probability<0||value.probability>100))throw new Error('证实概率需为 0–100 或待评估');
 const out={status:value.status,probability:value.probability};
 for(const key of keys.filter(k=>!['status','probability'].includes(k))){if(typeof value[key]!=='string'||value[key].length>2000)throw new Error('评估字段最多 2000 字符');out[key]=value[key].trim();}
 if(!out.claim)throw new Error('请明确被评估的主张');
 if(out.probability!==null&&(!out.basis||!out.impactIfTrue||!out.impactIfFalse||!out.resolveBy))throw new Error('概率需包含依据、真伪两种影响及检验截止日');
 if(out.resolveBy){let valid=false;try{valid=/^\d{4}-\d{2}-\d{2}$/.test(out.resolveBy)&&new Date(out.resolveBy+'T00:00:00Z').toISOString().slice(0,10)===out.resolveBy;}catch{}if(!valid)throw new Error('检验日期无效');}
 return out;
}
