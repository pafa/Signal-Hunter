import {COMPANY_ANALYSIS_FIELDS} from './company-directory.mjs';

export const COMPANY_ASSESSMENT_VERSION='company-assessment/1';
export const COMPANY_ASSESSMENT_FIELDS={...COMPANY_ANALYSIS_FIELDS,entryCondition:'进入观察条件',exitCondition:'减仓 / 退出条件',invalidation:'判断失效条件'};
export const COMPANY_ASSESSMENT_BASES={source:'来源陈述 · 待核实',inference:'模型推断',unknown:'依据不足'};

// Preserve the saved version even when someone edits the surrounding dossier.
export function savedCompanyAssessment(topic,symbol){
 const saved=topic.dossier?.companyAssessment,assessment=saved?.assessments.find(a=>a.symbol===symbol);
 if(!assessment)return null;
 return {assessment,inputTopicVersion:saved.inputTopicVersion,savedInResearchVersion:saved.savedInResearchVersion,
  sourceModelRunId:saved.sourceModelRunId,preparedAt:saved.preparedAt,
  researchChanged:topic.version!==saved.savedInResearchVersion||topic.status!=='active'};
}
