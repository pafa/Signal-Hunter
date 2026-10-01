import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {runtimeConfig} from '../server/runtime.mjs';
const [platform,output,mode='demo']=process.argv.slice(2);
if(!['macos','linux'].includes(platform)||!output)throw new Error('用法：node scripts/service-config.mjs macos|linux <新配置文件路径> [demo|research|legacy]');
const config=runtimeConfig({...process.env,SIGNAL_MODE:mode,SIGNAL_SERVE_STATIC:'1'});
const cwd=fileURLToPath(new URL('../',import.meta.url)),runner=resolve(cwd,'scripts/start.mjs');
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const label='org.signal-hunter.'+mode;
const env={SIGNAL_MODE:mode,SIGNAL_SERVE_STATIC:'1',SIGNAL_DB_PATH:config.dbPath,SIGNAL_FRONTEND_PORT:String(config.frontendPort),SIGNAL_API_PORT:String(config.apiPort)};
const quote=s=>'"'+String(s).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
const text=platform==='macos'?`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(runner)}</string><string>${mode}</string><string>--production</string></array>
<key>WorkingDirectory</key><string>${xml(cwd)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k,v])=>'<key>'+k+'</key><string>'+xml(v)+'</string>').join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer>
</dict></plist>
`:`[Unit]
Description=Signal Hunter private local workbench
[Service]
Type=simple
WorkingDirectory=${quote(cwd)}
ExecStart=${quote(process.execPath)} ${quote(runner)} ${mode} --production
${Object.entries(env).map(([k,v])=>'Environment='+quote(k+'='+v)).join('\n')}
Restart=on-failure
RestartSec=30
TimeoutStopSec=12
UMask=0077
[Install]
WantedBy=default.target
`;
writeFileSync(resolve(output),text,{flag:'wx',mode:0o600});
console.log('仅生成配置，尚未安装或启用：'+resolve(output));
