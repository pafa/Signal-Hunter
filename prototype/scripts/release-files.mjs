import {readdirSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const releaseRoot=fileURLToPath(new URL('../../',import.meta.url));
const files=['README.md','README.en.md','CHANGELOG.md','LICENSE','.nvmrc','.gitignore','.editorconfig','.gitattributes','AGENTS.md','CONTRIBUTING.md','SECURITY.md','THIRD_PARTY_NOTICES.md',
 'docs/MARKET-SIMULATION.md','docs/DEPLOYMENT.md','docs/BRANDING.md','docs/ARCHITECTURE.md','docs/DATA-POLICY.md','docs/OPEN-SOURCE.md','docs/DECISIONS.md','docs/BACKLOG.md','docs/EVALUATION-PROTOCOL.md','docs/MAJOR-EVENT-SYSTEM.md',
 'docs/assets/README.md','docs/assets/workbench.png','docs/assets/product-logic.png',
 '.github/workflows/ci.yml','.github/pull_request_template.md','.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/feature_request.yml','.github/ISSUE_TEMPLATE/config.yml',
 'prototype/README.md','prototype/package.json','prototype/package-lock.json','prototype/index.html','prototype/vite.config.js','prototype/public/signal.svg','prototype/public/major-event-design.html'];
const trees=['prototype/server','prototype/shared','prototype/src','prototype/tests','prototype/scripts'];
const allowed=/\.(?:mjs|js|jsx|css|html)$/;
export function releaseFiles(root=releaseRoot){
 if(lstatSync(root).isSymbolicLink())throw new Error('不发布符号链接根目录');
 const result=[...files];
 const walk=dir=>{if(lstatSync(resolve(root,dir)).isSymbolicLink())throw new Error(`不发布符号链接：${dir}`);for(const entry of readdirSync(resolve(root,dir),{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isSymbolicLink())throw new Error(`不发布符号链接：${path}`);if(entry.isDirectory())walk(path);else if(allowed.test(entry.name))result.push(path);else throw new Error(`允许的源码目录出现未审阅文件：${path}`);}};
 trees.forEach(walk);
 for(const path of result){let parent=root;for(const part of path.split('/').slice(0,-1)){parent=resolve(parent,part);if(lstatSync(parent).isSymbolicLink())throw new Error(`不发布符号链接目录：${path}`);}if(!lstatSync(resolve(root,path)).isFile())throw new Error(`不是普通文件：${path}`);}
 return [...new Set(result)].sort();
}
export function checkRelease(root=releaseRoot){
 const paths=releaseFiles(root),errors=[],manifest={};const included=new Set(paths);
 for(const path of paths){
  const bytes=readFileSync(resolve(root,path)),text=bytes.toString('utf8');
  manifest[path]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-proj-)[a-zA-Z0-9_\-]{20,}|\bAKIA[A-Z0-9]{16}\b/.test(text))errors.push(`${path}: 疑似凭据（内容未输出）`);
  if(/(?:api[_-]?key|password|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i.test(text))errors.push(`${path}: 疑似硬编码秘密（内容未输出）`);
  if(/\/Users\/|\/private\/tmp\/|file:\/\/\//.test(text))errors.push(`${path}: 本机绝对路径`);
  if(path.endsWith('.md'))for(const [,target] of text.matchAll(/\]\(([^)]+)\)/g)){
   if(/^(?:https?:|#|mailto:)/.test(target))continue;
   const local=target.split('#')[0];if(!local)continue;
   const absolute=resolve(root,dirname(path),decodeURIComponent(local)),relative=absolute.slice(resolve(root).length+1);
   if(!included.has(relative))errors.push(`${path}: 发布包缺少链接目标 ${local}`);
  }
 }
 const lock=JSON.parse(readFileSync(resolve(root,'prototype/package-lock.json'),'utf8'));
 for(const [name,p] of Object.entries(lock.packages))if(!p.license)errors.push(`依赖许可证缺失：${name}`);
 if(errors.length)throw new Error(errors.join('\n'));
 return manifest;
}
