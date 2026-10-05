import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {releaseFiles,releaseRoot} from './release-files.mjs';
import {rehearseRecovery} from '../server/recovery-rehearsal.mjs';

try{
 const [snapshot,output,...extra]=process.argv.slice(2);
 if(!snapshot||!output||extra.length)throw new Error('用法：npm run recovery:rehearse -- <备份目录> <独立演练目录>');
 const paths=releaseFiles().filter(p=>/^prototype\/(?:server|shared|scripts)\//.test(p)||/^prototype\/package(?:-lock)?\.json$/.test(p));
 const sources=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(join(releaseRoot,p))).digest('hex')]));
 let gitHead=null;try{gitHead=execFileSync('git',['rev-parse','HEAD'],{cwd:releaseRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{/* Exported releases need not contain Git metadata. */}
 const candidate={gitHead,sourceHash:createHash('sha256').update(JSON.stringify(sources)).digest('hex'),files:sources};
 const report=await rehearseRecovery(snapshot,output,{candidate});
 console.log(JSON.stringify({passed:report.passed,report:join(report.directory,'report.json'),scope:report.scope},null,2));
 if(!report.passed)process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
