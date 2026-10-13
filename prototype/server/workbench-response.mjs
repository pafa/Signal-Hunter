import {createHash} from 'node:crypto';
import {safeDiagnosticPayload} from '../shared/safe-errors.mjs';
import {compactActualChecks} from './actual-check-response.mjs';

// Revalidate the complete projected content on every read, including derived
// availability fields. A research version alone is not a cache validator.
export function workbenchResponse(snapshot,knownHash,holdingChecks){
 const payload=safeDiagnosticPayload(compactActualChecks(snapshot,holdingChecks)),identity=payload.runtime?.instance?.id;
 const headers={};
 if(typeof identity==='string'&&identity&&Array.isArray(payload.research?.topics)){
  const hash=createHash('sha256').update(JSON.stringify([identity,payload.research.topics])).digest('hex');
  headers['X-Signal-Topics-Hash']=hash;
  if(knownHash===hash){
   const {topics,...research}=payload.research;
   payload.research={...research,topicsUnchanged:true};
  }
 }
 return {body:JSON.stringify(payload),headers};
}
