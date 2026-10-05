import {resolve} from 'node:path';
import {readComparisonArtifact as read,writeComparisonArtifact as write} from '../server/model-comparison.mjs';
import {recallLabelTemplate,freezeRecallEvaluation,saveRecallEvaluation,readRecallEvaluation} from '../server/recall-evaluation.mjs';
const [action,...args]=process.argv.slice(2);
try{
 if(action==='template'&&args.length===2){const template=recallLabelTemplate(read(resolve(args[0])));write(resolve(args[1]),template);console.log(JSON.stringify({reportHash:template.reportHash,labels:template.labels.length,requiresReview:true}));}
 else if(action==='freeze'&&args.length===3){const evaluation=freezeRecallEvaluation(read(resolve(args[0])),read(resolve(args[1])));saveRecallEvaluation(resolve(args[2]),evaluation);console.log(JSON.stringify({hash:evaluation.hash,summary:evaluation.summary,topK:evaluation.topK,forwardEligible:false},null,2));}
 else if(action==='report'&&args.length===1){const p=readRecallEvaluation(resolve(args[0]));console.log(JSON.stringify({hash:p.hash,reportHash:p.report.hash,title:p.reference.title,reviewer:p.reference.reviewer,origin:p.reference.origin,resultsSeen:p.reference.resultsSeen,summary:p.summary,topK:p.topK,rows:p.rows,forwardEligible:false,limitations:p.limitations},null,2));}
 else throw Error();
}catch{console.error('历史召回评估未完成。用法：recall:evaluate -- template <导出报告.json> <新标注.json>；freeze <导出报告.json> <完整标注.json> <全新目录>；report <目录>。核对完整输入、每条标注、版本及指纹，不覆盖已有文件。');process.exitCode=1;}
