import React from 'react';
import {createRoot} from 'react-dom/client';
import IntegratedWorkbench from './integrated/IntegratedWorkbench';
import './styles.css';
const url=new URL(window.location.href);
if(['classic','demo','research-v4'].includes(url.searchParams.get('view'))){url.searchParams.set('view','grid');window.history.replaceState(null,'',url);}
createRoot(document.getElementById('root')).render(<IntegratedWorkbench/>);
