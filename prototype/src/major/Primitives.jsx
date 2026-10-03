import React,{createContext,useContext,useEffect,useId,useRef} from 'react';
export const ErrorContext=createContext('');
export function Button({children,primary=false,...props}){return <button className={`m-button ${primary?'m-primary':''}`} {...props}>{children}</button>;}
export function Panel({title,meta,tools,children,className=''}){return <section className={`m-panel ${className}`} aria-label={title}><header className="m-panel-head"><h2>{title}</h2>{meta&&<span>{meta}</span>}<div>{tools}</div></header>{children}</section>;}
export function Modal({title,onClose,children}){
 const error=useContext(ErrorContext),titleId=useId(),heading=useRef(null);
 const ref=useRef(null);useEffect(()=>{const el=ref.current,previous=document.activeElement;el.showModal();heading.current?.focus({preventScroll:true});return()=>{el.close();if(previous?.isConnected)previous.focus?.();};},[]);
 return <dialog ref={ref} className="m-modal" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}}><header><h2 ref={heading} id={titleId} tabIndex={-1}>{title}</h2><Button type="button" onClick={onClose}>关闭</Button></header><div className="m-modal-body">{error&&<p className="m-warning" role="alert">{error}</p>}{children}</div></dialog>;
}
export function Spark({quote,large=false}){
 if(!quote?.points?.length)return <span className="m-muted">尚无行情</span>;
 const points=quote.points,min=Math.min(...points.map(p=>p.close)),max=Math.max(...points.map(p=>p.close)),range=max-min||Math.max(min*.001,1),w=large?600:80,h=large?120:25;
 return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={large?'m-chart':'m-spark'} role="img" aria-label={`${quote.name} ${quote.symbol} 一分钟收盘走势`}>{large&&<path d="M0 20H600M0 60H600M0 100H600" stroke="#263347" fill="none"/>}<polyline points={points.map((p,i)=>`${i*w/Math.max(1,points.length-1)},${h-4-(p.close-min)/range*(h-8)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={large?2:1.4}/></svg>;
}
export function Empty({title,children}){return <div className="m-empty"><svg viewBox="0 0 32 38" aria-hidden="true"><path d="M5 1h15l8 8v27H5zM19 1v10h9M10 19h12M10 25h9" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg><strong>{title}</strong><p>{children}</p></div>;}
