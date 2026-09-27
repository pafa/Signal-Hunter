import React from 'react';
import {urgencyNames} from './fixtures';
export function Pane({title,meta,tools,className='',children}){return <section className={`terminal-pane ${className}`} aria-label={title}><header className="pane-head"><h2>{title}</h2>{meta&&<span className="pane-meta">{meta}</span>}<div className="pane-tools">{tools}</div></header>{children}</section>;}
export function Urgency({level}){return <span className={`urgency ${level}`}>{urgencyNames[level]}</span>;}
export function TButton({children,tone='',className='',...props}){return <button className={`terminal-button ${tone} ${className}`} {...props}>{children}</button>;}
export function MiniTrend({stock}){const values=stock.trend,min=Math.min(...values),range=Math.max(...values)-min||1;return <svg viewBox="0 0 78 24" className={`mini-trend ${values.at(-1)<0?'loss':'profit'}`} aria-label={`${stock.name}示例趋势`} role="img"><polyline fill="none" stroke="currentColor" strokeWidth="1.6" points={values.map((v,i)=>`${i*78/(values.length-1)},${21-(v-min)/range*18}`).join(' ')}/></svg>;}
