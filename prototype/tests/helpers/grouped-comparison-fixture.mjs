import {validateComparisonCandidate} from '../../server/semantic-events.mjs';
import {digest} from '../../server/codex-research.mjs';
import {COMPARISON_GROUP_VERSION,comparisonGroupPackets} from '../../server/semantic-multiplex.mjs';

// Synthetic test outputs only: exercise the real shared-call contract while
// retaining existing per-pair scenario generators and their business assertions.
export const groupedComparisonFixture=single=>async(packet,config)=>{
 if(packet.schema!==COMPARISON_GROUP_VERSION)return single(packet,config);
 const comparisons={};let trace;
 for(const [i,pair] of comparisonGroupPackets(packet).entries()){const c=await single(pair,config);validateComparisonCandidate(c,pair,c.trace?.model,{requireTimeEvidence:true});comparisons[packet.input.pairs[i].id]=c.comparison;trace=c.trace;}
 const rawOutput=JSON.stringify({comparisons});
 return {status:'candidate',reviewStatus:'unreviewed',comparisons,rawOutput,trace:{...trace,inputHash:packet.inputHash,outputHash:digest(rawOutput),promptVersion:COMPARISON_GROUP_VERSION}};
};
