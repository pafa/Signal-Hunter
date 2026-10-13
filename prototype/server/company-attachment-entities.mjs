import {currentDocumentResearch} from './research-document-context.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
export {ATTACHMENT_ENTITIES_VERSION} from './company-ownership.mjs';
import {validParentConnection} from './company-ownership.mjs';
export const EVENT_CONNECTION_SCHEMA={type:'object',additionalProperties:false,required:['relation','anchorQuote','reason'],properties:{relation:{type:'string',enum:['direct','context','unrelated','unclear']},anchorQuote:{type:'string',maxLength:1500},reason:{type:'string',minLength:1,maxLength:1200}}};

// Only a currently usable, explicitly linked attachment may widen identity
// reading beyond the originating event quote. This does not widen the event.
export function attachmentIdentityContext(store,research,topic,material,scope){
 const ref=topic.evidence.find(e=>e.materialId===material.id&&e.materialRevision===material.revision&&e.documentRole==='linked-attachment');
 const entries=topic.documentContext?.entries.filter(e=>e.status==='available'&&e.materialId===material.id&&e.materialRevision===material.revision&&e.evidenceId===ref?.id)||[];
 if(!ref||!entries.length||material.method!=='public-web'||!currentDocumentResearch(store,research,topic))throw Error('附件身份识别需要当前可用的明确文档关联');
 const parent=immutableMaterialSnapshot(store.db,{id:scope.materialId,revision:scope.materialRevision});
 return {schema:'attachment-company-context/1',originMaterial:{id:parent.id,revision:parent.revision,title:parent.title,url:parent.url,quoteField:scope.eventFocus.quoteField,quote:scope.eventFocus.quote},links:entries.map(e=>({parentMaterialId:e.parentMaterialId,parentMaterialRevision:e.parentMaterialRevision,url:e.url,materialId:e.materialId,materialRevision:e.materialRevision,sourceTopicId:e.sourceTopicId,sourceTopicVersion:e.sourceTopicVersion,newsId:e.newsId,newsRevision:e.newsRevision,searchId:e.searchId,sourceRunId:e.sourceRunId})),limitation:'明确附件只证明文档入口关系；附件中的主体仍须核对与原事项的关系，不能自动视为业务敞口、独立佐证或受益证券'};
}

export function validAttachmentConnection(mention,packet){
 const c=mention.eventConnection;
 if(c?.relation==='parent')return validParentConnection(mention,packet);
 return !!c&&!Array.isArray(c)&&Object.keys(c).sort().join(',')==='anchorQuote,reason,relation'&&['direct','context','unrelated','unclear'].includes(c.relation)&&typeof c.reason==='string'&&!!c.reason.trim()&&c.reason.length<=1200&&typeof c.anchorQuote==='string'&&c.anchorQuote.length<=1500&&(c.anchorQuote===''?c.relation!=='direct':!!c.anchorQuote.trim()&&packet.input.eventFocus.quote.includes(c.anchorQuote));
}

export const ATTACHMENT_IDENTITY_INSTRUCTIONS=`本次是原事项明确附件中的主体核对。input.material为一份已归档附件，identityAttachment.originMaterial.quote与eventFocus限定原事项。附件本身可能包含多个无关事项、发行人常规背景和其他公司，不能仅因它被原通知链接就断言每个提及与当前事项相关。
每项mention新增eventConnection：relation=direct仅用于附件原文明确说明该主体参与、执行、受约束或承担原事项中同一动作/对象的情形；context表示仅作背景，unrelated表示明确属于其他事项，unclear表示无法核对。anchorQuote只能逐字引用eventFocus.quote中的片段；direct必须有非空anchorQuote，并在reason中具体说明附件quote与原事项动作/对象如何对应。quote必须来自附件本身并包含name，不得把原新闻句子当附件引用，不能凭模型记忆或近似名称补齐关系。共同提到一个行业、国家、金额或上级政策，不足以direct。
身份与事项关联分开：即使目录身份唯一，context/unrelated/unclear也不能作为原事项新增公司关联。子公司、品牌、产品和母公司的关系不得推测；保留原有多市场歧义。直接文档关联仍不证明订单、上市状态、财务敞口、利好利空或可交易性。每份附件单独核对，保留未知和未识别范围。
`;
