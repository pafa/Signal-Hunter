import {validateDossierSections} from '../shared/research-dossier.mjs';
import {researchReadiness} from '../shared/research-readiness.mjs';
import {normalizeCompanyRelation} from '../shared/company-directory.mjs';
import {openScreeningSamples} from './screening-samples.mjs';
import {claimsOf,validateClaim,assessmentFields,researchDelta,assertClaimIdentity} from '../shared/claims.mjs';
import {validateAssessment} from '../shared/uncertainty.mjs';
import {randomUUID} from 'node:crypto';
import {instrument,hash} from './providers.mjs';
import {classifyHeadline,evidenceCoverage,RULES_VERSION} from './triage.mjs';
import {researchSeeds} from './research-seeds.mjs';
import {validateResearchBrief} from './research-brief.mjs';
import {openMaterials} from './research-materials.mjs';
import {readPublicArticle,publicSourceUrl} from './source-reader.mjs';
import {RELATION_KINDS,relatedCandidates} from '../shared/research-links.mjs';

const text=(value,max=2000)=>typeof value==='string'&&value.trim().length<=max?value.trim():null;
const assertText=(value,name,max=2000)=>{const result=text(value,max);if(result===null||!result)throw new Error(`${name}不能为空且最多 ${max} 字符`);return result;};
const safeUrl=value=>{if(!value)return '';let u;try{u=new URL(value);}catch{throw new Error('来源需为 HTTPS 链接');}if(u.protocol!=='https:'||u.username||u.password)throw new Error('来源需为无凭据的 HTTPS 链接');return u.href;};
const enums={stance:['supports','against','context','unverified'],family:['adoption','mechanism','ecosystem','constraint','supply','purchase','earnings','corporate','other'],action:['observe','buy','add','reduce','exit']};
const dateValid=value=>{try{return /^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;}catch{return false;}};
const defaultChain=()=>[{id:'fact',title:'事实变化',question:'相对原有信息改变了什么？'},{id:'mechanism',title:'影响机制',question:'变化如何传到公司的业务？'},{id:'earnings',title:'财务兑现',question:'如何改变盈利及事前预期？'}];

export function openResearch(store,{seed=true,clock=()=>new Date().toISOString(),sourceReader=readPublicArticle,seeds=researchSeeds}={}) {
 const db=store.db;
 const screenings=openScreeningSamples(db,{clock}),triageKey=`${RULES_VERSION}@${screenings.rulesHash}`;
 const materials=openMaterials(db,{clock}),sourceJobs=new Set();
 db.exec(`CREATE TABLE IF NOT EXISTS research_topics(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS research_versions(topic_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,recorded_at TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(topic_id,version));
 CREATE TABLE IF NOT EXISTS triage(news_id TEXT NOT NULL,news_revision INTEGER NOT NULL,rules_version TEXT NOT NULL,payload TEXT NOT NULL,processed_at TEXT NOT NULL,PRIMARY KEY(news_id,news_revision,rules_version));`);
 const get=id=>{const r=db.prepare('SELECT payload FROM research_topics WHERE id=?').get(id);if(!r)throw new Error('研究主题不存在');return JSON.parse(r.payload);};
 const withAvailability=topic=>({...topic,evidence:topic.evidence.map(e=>e.newsId?{...e,availableAt:store.revisionAvailableAt(e.newsId,e.newsRevision),availabilityBasis:'新闻修订实际接收时间；历史原字段保留'}:e)});
 const newsEvidence=(n,at)=>({id:`news:${n.id}:v${n.revision}`,newsId:n.id,newsRevision:n.revision,claim:n.title,sourceName:n.publisher,url:n.url,publishedAt:n.publishedAt,datePrecision:'instant',firstSeen:n.revisionFirstSeen,articleFirstSeen:n.articleFirstSeen,revisionFirstSeen:n.revisionFirstSeen,availableAt:n.revisionFirstSeen,originKey:n.publisher,verification:'unverified',contentScope:'headline-only',addedAt:at});
 const commit=(topic,reason,expectedVersion,beforeWrite=()=>{})=>{
  db.exec('BEGIN IMMEDIATE');try{
   const old=db.prepare('SELECT payload FROM research_topics WHERE id=?').get(topic.id);const current=old?JSON.parse(old.payload):null;
   if(current&&expectedVersion!==current.version)throw new Error('研究已更新，请刷新后再保存，避免覆盖其他修改');
   const next={...topic,version:(current?.version||0)+1,updatedAt:clock()};const payload=JSON.stringify(next);
   beforeWrite();
   db.prepare('INSERT INTO research_topics VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(topic.id,payload);
   db.prepare('INSERT INTO research_versions VALUES(?,?,?,?,?)').run(topic.id,next.version,payload,next.updatedAt,reason);
   db.exec('COMMIT');return next;
  }catch(e){db.exec('ROLLBACK');throw e;}
 };
 if(seed){for(const topic of seeds(clock()))if(!db.prepare('SELECT 1 FROM research_topics WHERE id=?').get(topic.id))commit(topic,'回溯案例初始化：不是当时发现');}
 const process=()=>{
  const insert=db.prepare('INSERT OR IGNORE INTO triage VALUES(?,?,?,?,?)');
  const pending=db.prepare('SELECT n.id FROM news n WHERE NOT EXISTS (SELECT 1 FROM triage t WHERE t.news_id=n.id AND t.news_revision=n.revision AND t.rules_version=?) OR NOT EXISTS (SELECT 1 FROM screening_samples s WHERE s.news_id=n.id AND s.revision=n.revision AND s.rules_hash=?) ORDER BY n.last_seen DESC,n.rowid DESC LIMIT 2000').all(triageKey,screenings.rulesHash);
  db.exec('BEGIN IMMEDIATE');try{
  for(const row of pending){const news=store.newsById(row.id);
   const triage=classifyHeadline(news),at=clock();
   insert.run(news.id,news.revision,triageKey,JSON.stringify(triage),at);
   screenings.capture(news,triage,at);
  }
  db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 };
 const list=()=>db.prepare('SELECT payload FROM research_topics').all().map(r=>{const topic=withAvailability(JSON.parse(r.payload));const prior=db.prepare('SELECT payload FROM research_versions WHERE topic_id=? AND version<? ORDER BY version DESC LIMIT 1').get(topic.id,topic.version);return {...topic,coverage:evidenceCoverage(topic),changeSummary:researchDelta(topic,prior?JSON.parse(prior.payload):null)};}).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||(a.type==='cluster'?0:1)-(b.type==='cluster'?0:1)||a.id.localeCompare(b.id));
 const linkMaterial=(id,data,input,method)=>{
  const topic=get(id);if(data.version!==topic.version)throw new Error('研究已更新，材料未关联；请刷新后重试');
  if(!enums.stance.includes(data.stance)||!enums.family.includes(data.family)||!topic.chain.some(s=>s.id===data.step))throw new Error('材料作用、类别或因果环节无效');
  const interpretation=assertText(data.interpretation,'材料与本事件的关系',1200),prepared=materials.prepare(id,input,method),m=prepared.material;
  if(topic.evidence.some(e=>e.materialId===m.id))return topic;
  if(topic.evidence.length>=150)throw new Error('一个主题最多保存 150 条证据');
  topic.evidence.push({id:`material:${m.id}`,materialId:m.id,materialRevision:m.revision,claim:m.title,sourceName:m.sourceName,url:m.url,publishedAt:m.publishedAt,datePrecision:m.datePrecision,firstSeen:m.availableAt,availableAt:m.availableAt,addedAt:clock(),originKey:m.url?new URL(m.url).hostname:m.sourceName,verification:'unverified',contentScope:m.scope,stance:data.stance,family:data.family,step:data.step,interpretation});
  return commit(topic,'补充研究材料：阅读范围与不可变正文快照已保存；内容尚待核验',data.version,()=>{prepared.persist();materials.attempt(id,{state:'saved',url:m.url,materialId:m.id,method});});
 };
 return {
  process,get,list,screenings,
  newsItem(id){const news=store.newsById(id);if(!news)throw new Error('新闻不存在');return {...news,triage:classifyHeadline(news)};},
  materialList(id){return materials.list(get(id));},
  packet(id){return materials.packet(withAvailability(get(id)));},
  adoptModelDraft(id,data,candidate,beforeWrite=()=>{}){
   const topic=get(id),packet=materials.packet(withAvailability(topic));
   if(data.version!==topic.version||candidate?.trace?.inputHash!==packet.inputHash||candidate?.trace?.topicId!==id||candidate?.trace?.topicVersion!==topic.version||candidate?.status!=='candidate')throw new Error('模型候选与当前研究不匹配，请重新生成');
   const sections=validateDossierSections(candidate.sections,topic.evidence);
   topic.dossier={sections,reviewStatus:'draft',revisionReason:'本人采纳 Codex 候选为待复核草稿',preparedBy:'Codex 模型候选 · 本人采纳，尚待复核',preparedAt:clock(),basedOnResearchVersion:topic.version+1,sourceModelRun:{id:data.runId,...candidate.trace},missingEvidence:candidate.missingEvidence};
   topic.researchUpdatedAt=clock();
   return commit(topic,'采纳模型研判草稿：未标记完成、未提交交易',data.version,beforeWrite);
  },
  related(id){
   const topic=get(id),topics=list();
   const links=(topic.relatedEvents||[]).map(link=>({...link,title:get(link.topicId).title,currentVersion:get(link.topicId).version}));
   const incoming=topics.flatMap(t=>(t.relatedEvents||[]).filter(link=>link.topicId===id&&link.active).map(link=>({...link,topicId:t.id,title:t.title,currentVersion:t.version})));
   return {candidates:relatedCandidates(topic,topics),links,incoming,method:'source-entity-title-retrieval-1'};
  },
  linkTopic(id,data){
   const topic=get(id);if(data.version!==topic.version)throw new Error('研究已更新，请刷新后再关联');
   if(data.topicId===id)throw new Error('不能把事件关联到自身');const target=get(data.topicId);
   if(data.targetVersion!==target.version)throw new Error('目标事件已有新版本，请重新核对');
   if(!Object.hasOwn(RELATION_KINDS,data.kind)||typeof data.active!=='boolean')throw new Error('事件关系类型无效');
   const note=assertText(data.note,'事件关系依据',1200),links=topic.relatedEvents||[],index=links.findIndex(l=>l.topicId===target.id&&l.kind===data.kind);
   if(index<0&&links.length>=40)throw new Error('一个事件最多保存 40 条关系');
   if(index<0&&!data.active)throw new Error('该关系尚未建立');
   const link={topicId:target.id,targetVersion:target.version,kind:data.kind,active:data.active,note,at:clock(),method:'human-linked'};
   if(index>=0)links[index]=link;else links.push(link);topic.relatedEvents=links;
   return commit(topic,`${data.active?'关联':'撤销'}事件关系：${RELATION_KINDS[data.kind]}；不合并证据或重复计权`,data.version);
  },
  saveMaterial(id,data){return linkMaterial(id,data,{...data,scope:data.scope==='extracted-text'?null:data.scope},'manual');},
  async readMaterial(id,data){
   const topic=get(id);if(data.version!==topic.version)throw new Error('研究已更新，请刷新后再读取');
   if(!enums.stance.includes(data.stance)||!enums.family.includes(data.family)||!topic.chain.some(s=>s.id===data.step))throw new Error('材料作用、类别或因果环节无效');
   assertText(data.interpretation,'材料与本事件的关系',1200);const url=publicSourceUrl(assertText(data.url,'来源链接',2000)).href;
   if(sourceJobs.has(id))throw new Error('本事件的来源正在读取，请等待结果');
   if(sourceJobs.size>=2)throw new Error('已有两份来源正在读取，请稍后重试');
   sourceJobs.add(id);
   try{return linkMaterial(id,data,await sourceReader(url),'public-web');}
   catch(error){materials.attempt(id,{state:'failed',url,method:'public-web',error:String(error.message).slice(0,300)});throw error;}
   finally{sourceJobs.delete(id);}
  },
  newsPage({q='',bucket='all',before,ceiling,limit=30}={}){
   if(typeof q!=='string'||q.length>120||!['all','review','clue','quiet','pending','rumor'].includes(bucket))throw new Error('新闻检索参数无效');
   const maxRow=db.prepare('SELECT MAX(rowid) n FROM news').get().n||0;
   const upper=ceiling===undefined?maxRow:Number(ceiling),cursor=before===undefined?upper+1:Number(before),size=Number(limit);
   if(![upper,cursor,size].every(Number.isSafeInteger)||upper<0||cursor<1||size<1||size>100)throw new Error('新闻分页参数无效');
   const clauses=['n.rowid<=?'],args=[triageKey,upper];
   if(q.trim()){clauses.push("instr(lower(json_extract(n.payload,'$.title')),lower(?))>0");args.push(q.trim());}
   if(bucket==='pending')clauses.push('t.news_id IS NULL');
   else if(bucket!=='all'){clauses.push(`json_extract(t.payload,'$.${bucket==='rumor'?'messageStatus':'bucket'}')=?`);args.push(bucket);}
   const from='FROM news n LEFT JOIN triage t ON t.news_id=n.id AND t.news_revision=n.revision AND t.rules_version=? WHERE '+clauses.join(' AND ');
   const total=db.prepare('SELECT COUNT(*) n '+from).get(...args).n;
   const rows=db.prepare('SELECT n.id,n.rowid cursor,t.payload triage,t.processed_at '+from+' AND n.rowid<? ORDER BY n.rowid DESC LIMIT ?').all(...args,cursor,size+1);
   const items=rows.slice(0,size).map(r=>({...store.newsById(r.id),triage:r.triage?JSON.parse(r.triage):{bucket:'pending',category:'等待初筛',companies:[]},processedAt:r.processed_at||null}));
   return {items,total,screeningSamples:screenings.stats(),ceiling:upper,nextCursor:rows.length>size?rows[size-1].cursor:null,rulesVersion:RULES_VERSION,order:'首次入库倒序；筛选使用当前修订，新入库记录在重新检索时纳入'};
  },
  createFromNews(data){
   const n=store.newsById(data.newsId);
   if(!n||n.revision!==data.newsRevision)throw new Error('新闻版本已变化或不存在，请重新打开后创建');
   const id='news-candidate-'+hash(n.id).slice(0,24),existing=db.prepare('SELECT 1 FROM research_topics WHERE id=?').get(id);
   if(existing)return get(id);
   const at=clock(),triage=classifyHeadline(n);
   return commit({id,title:n.title.slice(0,140),summary:'标题候选，未阅读全文。需核验事件阶段、业务量级、公司关系和反证。',type:'event',label:triage.category,categoryId:triage.matchedRules[0]||'general',origin:'news-candidate',status:'active',createdAt:at,firstSeen:at,eventPublishedAt:n.publishedAt,sourceNewsId:n.id,sourceNewsRevision:n.revision,headlineStage:triage.stage,messageStatus:triage.messageStatus,chain:defaultChain(),evidence:[{...newsEvidence(n,at),stance:'unverified',family:'other',step:'fact',interpretation:'从新闻建立候选，未证实且未形成交易判断'}],companies:triage.companies.map(c=>({...c,note:'仅标题提及的实体候选；业务关系与影响方向待核验',url:n.url})),hypothesis:{logic:'核验来源后评估增量和公司影响；标题本身不构成买点。',trigger:'',invalidation:'',industryHorizon:'',holdingHorizon:'',reviewAt:'',action:'observe'},nextEvidence:'阅读来源，核对事件阶段和主体；补充相对业务规模、历史与反向线索。'},'新闻候选草稿：仅观察，已知实体候选进入关注；没有生成交易');
  },
  importBrief(data){
   const topic=validateResearchBrief(data,clock()),old=db.prepare('SELECT payload FROM research_topics WHERE id=?').get(topic.id);
   if(old){const saved=JSON.parse(old.payload);if(saved.importHash!==topic.importHash)throw new Error('该附件研判已有不同内容，请通过研究版本修订，不覆盖导入');return saved;}
   return commit(topic,'附件详细研判导入：来源核对与主观情景；仅观察，未提交交易');
  },
  importTestCase(data){
   // Local CLI only. Researcher annotations stay distinct from automated discovery and user approval.
   if(!data.id?.startsWith('recent-test-')||data.origin!=='recent-data-test'||!data.batchId||!data.inputHash)throw new Error('实测案例元数据无效');
   const old=db.prepare('SELECT payload FROM research_topics WHERE id=?').get(data.id);
   if(old){const topic=JSON.parse(old.payload);if(topic.inputHash!==data.inputHash)throw new Error('同批次案例已存在且内容不同，不能覆盖');return topic;}
   assertText(data.title,'标题',140);assertText(data.summary,'摘要');
   if(!Array.isArray(data.chain)||data.chain.length!==3||!data.evidence?.length||!data.companies?.length)throw new Error('实测案例必须有证据、因果链和公司');
   if(data.hypothesis?.action!=='observe'||!data.hypothesis?.invalidation||!Number.isFinite(Date.parse(data.firstSeen))||Date.parse(data.firstSeen)>Date.parse(clock()))throw new Error('实测只允许观察且获取时间不可在未来');
   for(const c of data.companies){instrument(c.symbol);assertText(c.note,'公司关联',500);}
   for(const e of data.evidence){safeUrl(e.url);assertText(e.claim,'事实',1200);if(!['primary','reported'].includes(e.verification)||!enums.stance.includes(e.stance)||!data.chain.some(s=>s.id===e.step))throw new Error('实测证据字段无效');}
   if(data.dossier){data={...data,dossier:{preparedAt:clock(),preparedBy:'研究者 · 实测人工研判',basedOnResearchVersion:1,sections:validateDossierSections(data.dossier.sections,data.evidence,{allowIncomplete:true}),reviewStatus:'draft'}};}
   return commit({...data,type:'event',status:'active',createdAt:clock()},'真实数据测试批次导入：研究者复核，首次获取在今日；未生成或批准交易');
  },
  snapshot(){const topics=list(),news=store.news();const rows=new Map(db.prepare('SELECT * FROM triage WHERE rules_version=?').all(triageKey).map(r=>[`${r.news_id}:${r.news_revision}`,r]));
   const inbox=news.map(n=>{const r=rows.get(`${n.id}:${n.revision}`);return {...n,triage:r?JSON.parse(r.payload):{bucket:'pending',category:'等待初筛',companies:[],tradeSignal:false},processedAt:r?.processed_at||null};});
   return {topics,inbox,rulesVersion:RULES_VERSION,screeningSamples:screenings.stats(),counts:{pending:inbox.filter(n=>n.triage.bucket==='pending').length,review:inbox.filter(n=>n.triage.bucket==='review').length,clue:inbox.filter(n=>n.triage.bucket==='clue').length,quiet:inbox.filter(n=>n.triage.bucket==='quiet').length},execution:'rules-only',positions:[],applications:[]};
  },
  create(data){const at=clock(),title=assertText(data.title,'主题标题',140),summary=assertText(data.summary,'研究假设');
   return commit({id:randomUUID(),title,summary,type:'cluster',label:'自建主题',origin:'user',status:'active',createdAt:at,chain:[{id:'fact',title:'事实变化',question:'什么证据能证实变化？'},{id:'mechanism',title:'影响机制',question:'变化如何传到目标公司的业务？'},{id:'earnings',title:'财务兑现',question:'如何改变预期与盈利？'}],evidence:[],companies:[],hypothesis:{logic:summary,trigger:'',invalidation:'',industryHorizon:'',holdingHorizon:'',reviewAt:'',action:'observe'},nextEvidence:'添加支持、反对或待核实线索，建立可证伪的因果链。'},'用户创建主题');
  },
  update(id,data){const topic=get(id);if(data.version!==topic.version)throw new Error('研究已更新，请刷新后再保存');
   const allowed=['version','status','hypothesis','assessment','nextEvidence','dossier'];if(Object.keys(data).some(k=>!allowed.includes(k)))throw new Error('不支持的研究修改');
   if(data.nextEvidence!==undefined)topic.nextEvidence=assertText(data.nextEvidence,'下一步观察点');
   if(data.status!==undefined){if(!['active','archived'].includes(data.status))throw new Error('研究状态无效');topic.status=data.status;}
   if(data.assessment!==undefined){
    if(topic.claims?.length)throw new Error('此事件已使用多主张，请在主张与概率中修订');
    const clean=validateAssessment(data.assessment);
    if(topic.assessment)assertClaimIdentity({...topic.assessment,kind:'outcome'},{...clean,kind:'outcome'});
    topic.assessment={...clean,assessedAt:clock(),method:'subjective-human'};topic.researchUpdatedAt=clock();
   }
   if(data.hypothesis){const h=data.hypothesis;if(typeof h!=='object'||Array.isArray(h)||Object.keys(h).some(k=>!['logic','trigger','invalidation','industryHorizon','holdingHorizon','reviewAt','action'].includes(k)))throw new Error('假设字段无效');
    for(const [key,val] of Object.entries(h)){if(text(val)===null)throw new Error('研究字段最多 2000 字符');if(key==='action'&&!enums.action.includes(val))throw new Error('研究动作无效');if(key==='reviewAt'&&val&&!dateValid(val))throw new Error('复核日期无效');}
    topic.hypothesis={...topic.hypothesis,...h};
    topic.researchUpdatedAt=clock();
   }
   if(data.dossier!==undefined){
    const d=data.dossier;if(!d||Object.keys(d).some(k=>!['sections','reviewStatus','revisionReason'].includes(k))||!['draft','complete'].includes(d.reviewStatus))throw new Error('研判修改字段无效');
    const sections=validateDossierSections(d.sections,topic.evidence,{allowIncomplete:d.reviewStatus==='draft'}),reason=assertText(d.revisionReason,'研判修订原因',1000);
    if(d.reviewStatus==='complete'&&(researchReadiness(topic).gaps.length||sections.some(s=>!s.sourceIds.length)))throw new Error('完成研判前需补齐研究记录并为每章关联来源；未知事项须说明核查方法');
    topic.dossier={sections,reviewStatus:d.reviewStatus,revisionReason:reason,preparedBy:'本人 · 人工结构化研判',preparedAt:clock(),basedOnResearchVersion:topic.version+1,...(topic.dossier?.sourceModelRun?{sourceModelRun:topic.dossier.sourceModelRun}:{})};topic.researchUpdatedAt=clock();
   }
   return commit(topic,data.status?'主题归档状态变更':data.dossier?'保存详细研判与人工完成状态（未提交交易）':data.assessment?'保存消息状态、概率与影响评估（未提交交易）':'保存交易假设（未提交交易申请）',data.version);
  },
  saveClaim(id,data){
   const topic=get(id);if(data.version!==topic.version)throw new Error('研究已更新，请刷新后再保存');
   if(Object.keys(data).some(k=>!['version','claim'].includes(k)))throw new Error('主张请求字段无效');
   const input=data.claim,clean=validateClaim(input,topic),claims=claimsOf(topic).map(c=>({...c}));
   const existing=input.id?claims.find(c=>c.id===input.id):null;
   if(input.id&&!existing)throw new Error('主张不存在');
   assertClaimIdentity(existing,clean);
   if(!existing&&claims.length>=20)throw new Error('每个事件最多 20 个主张');
   const at=clock(),next={...clean,id:existing?.id||randomUUID(),assessedAt:at,method:'subjective-human',firstAssessedAt:existing?.firstAssessedAt||existing?.assessedAt||at,firstProbability:existing&&Object.hasOwn(existing,'firstProbability')?existing.firstProbability:existing?existing.probability:clean.probability,resolvedAt:['true','false','partial'].includes(clean.outcome)?existing?.outcome===clean.outcome&&existing.resolvedAt||at:null};
   if(existing)claims[claims.findIndex(c=>c.id===existing.id)]=next;else claims.push(next);
   topic.claims=claims;
   // Keep the old single-assessment API as a view of the first claim; no destructive migration.
   if(claims[0].id===next.id)topic.assessment={...assessmentFields(next),assessedAt:at,method:next.method};
   topic.researchUpdatedAt=at;
   return commit(topic,`主张修订：${clean.revisionReason}`,data.version);
  },
  addCompany(id,data){const topic=get(id);
   if(data.replace!==undefined&&typeof data.replace!=='boolean')throw new Error('关系修订标记无效');
   if(data.version!==topic.version)throw new Error('研究已更新，请刷新后再保存');
   const company=normalizeCompanyRelation(data,topic,clock()),index=topic.companies.findIndex(c=>c.symbol===company.symbol);
   if(index>=0&&!data.replace)throw new Error('公司已关联；请选择修订关系，避免静默覆盖');
   if(index<0&&data.replace)throw new Error('待修订的公司关系不存在');
   if(index<0&&topic.companies.length>=20)throw new Error('一个主题最多关联 20 个标的');
   if(index>=0)topic.companies[index]=company;else topic.companies.push(company);
   return commit(topic,index>=0?'修订公司关系：旧关系保留在历史版本':'关联公司：主体、传导方向和关系来源分别记录',data.version);
  },
  removeCompany(id,data){const topic=get(id),symbol=instrument(data.symbol).symbol;
   if(data.version!==topic.version)throw new Error('研究已更新，请刷新后再保存');
   if(!topic.companies.some(c=>c.symbol===symbol))throw new Error('公司关系不存在');
   const note=assertText(data.note,'撤销关联原因',1200);topic.companies=topic.companies.filter(c=>c.symbol!==symbol);
   return commit(topic,'撤销公司关联 '+symbol+'：'+note+'；关注清单与持仓保留',data.version);
  },
  addEvidence(id,data){const topic=get(id);if(data.version!==topic.version)throw new Error('研究已更新，请刷新后再保存');
   if(!enums.stance.includes(data.stance)||!enums.family.includes(data.family))throw new Error('证据作用或类别无效');
   if(!topic.chain.some(step=>step.id===data.step))throw new Error('必须关联一个因果环节');
   let e;const at=clock();
   if(data.newsId){const n=store.newsById(data.newsId);if(!n)throw new Error('新闻不存在');
    if(data.newsRevision!==undefined&&data.newsRevision!==n.revision)throw new Error('新闻版本已变化，请重新打开核对');
    e=newsEvidence(n,at);
   }else{
    const claim=assertText(data.claim,'证据内容',1200),url=safeUrl(data.url),sourceName=assertText(data.sourceName||'用户线索','来源',160);
    if(data.publishedAt&&(!dateValid(data.publishedAt)||data.publishedAt>clock().slice(0,10)))throw new Error('来源日期无效或尚未发生');
    // Manual claims stay unverified; entering an official-looking URL is not verification.
    e={id:hash(`${claim}\n${url}`),claim,url,sourceName,publishedAt:data.publishedAt||null,datePrecision:data.publishedAt?'day':'unknown',firstSeen:at,originKey:url?new URL(url).hostname:'user',verification:'unverified',addedAt:at};
   }
   if(topic.evidence.some(old=>old.id===e.id))return topic;
   if(topic.evidence.length>=150)throw new Error('一个主题最多保存 150 条证据，请新建后续主题');
   e={...e,stance:data.stance,family:data.family,step:data.step,interpretation:assertText(data.interpretation,'关联解释',1200)};
   topic.evidence.push(e);return commit(topic,'新增证据 / 反证：保留当时来源与解释',data.version);
  },
  verifyEvidence(id,data){const topic=get(id);if(data.version!==topic.version)throw new Error('研究已更新，请刷新后再保存');
   const e=topic.evidence.find(e=>e.id===data.evidenceId);if(!e)throw new Error('证据不存在');
   if(!['confirmed','unverified'].includes(data.verdict))throw new Error('核验结果无效');
   if(!enums.stance.includes(data.stance))throw new Error('证据作用无效');
   const note=assertText(data.note,'核验依据',1200);
   e.verification=data.verdict==='confirmed'?'reviewed':'unverified';e.stance=data.stance;e.review={at:clock(),by:'user',note};
   return commit(topic,'人工核验 / 修正证据；旧核验保留在版本记录',data.version);
  },
  history(id){get(id);return db.prepare('SELECT * FROM research_versions WHERE topic_id=? ORDER BY version DESC').all(id).map(r=>({version:r.version,recordedAt:r.recorded_at,reason:r.reason,topic:withAvailability(JSON.parse(r.payload))}));},
 };
}
