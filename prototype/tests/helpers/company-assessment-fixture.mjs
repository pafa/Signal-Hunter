import {COMPANY_ASSESSMENT_FIELDS} from '../../shared/company-assessment.mjs';
export function unknownCompanyAssessments(packet){return (packet.input.companyAssessment?.targets||[]).map(t=>({symbol:t.symbol,direction:'unclear',analysis:Object.fromEntries(Object.keys(COMPANY_ASSESSMENT_FIELDS).map(k=>[k,{text:'合成测试没有足够业务与行情依据，保持未知',basis:'unknown',citations:[]}]))}));}
