import {useEffect,useRef,useState} from 'react';
import {currentInstanceId} from './api';
import {editorDraftKey,readEditorDraft,persistEditorDraft,resetEditorDraft,acknowledgeEditorDraft,subscribeEditorDraft} from './editor-drafts';
const storage=()=>{try{return window.sessionStorage;}catch{return null;}};
export default function useEditorDraft(topic,kind,initial,valid){
 const key=editorDraftKey(topic,currentInstanceId(),kind),[draft,setDraft]=useState(()=>readEditorDraft(key,{base:topic.version,value:initial()},valid,storage())),ref=useRef(draft);ref.current=draft;
 useEffect(()=>subscribeEditorDraft(key,d=>{ref.current=d;setDraft(d);}),[key]);
 const change=(value,base)=>persistEditorDraft(key,ref.current,typeof value==='function'?value(ref.current.value):value,storage(),base??ref.current.base);
 return {draft,change,reset:(value=initial(),base=topic.version)=>resetEditorDraft(key,value,base,storage()),ack:(submitted,value,base)=>acknowledgeEditorDraft(key,submitted,value,base,storage())};
}
