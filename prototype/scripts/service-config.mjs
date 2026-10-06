import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {runtimeConfig} from '../server/runtime.mjs';
const [platform,output,requestedMode]=process.argv.slice(2);
if(!['macos','linux'].includes(platform)||!output)throw new Error('用法：node scripts/service-config.mjs macos|linux <新配置文件路径> [demo|research|legacy]');
const config=runtimeConfig({...process.env,...(requestedMode?{SIGNAL_MODE:requestedMode}:process.env.SIGNAL_INSTANCE_PROFILE?{}:{SIGNAL_MODE:process.env.SIGNAL_MODE||'demo'}),SIGNAL_SERVE_STATIC:'1'}),mode=config.mode;
const cwd=fileURLToPath(new URL('../',import.meta.url)),runner=resolve(cwd,'scripts/start.mjs');
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const label='org.signal-hunter.'+mode+(config.instance.fixed?'.'+config.instance.id.slice(0,8):'');
const env={...(process.env.SIGNAL_INSTANCE_PROFILE?{SIGNAL_INSTANCE_PROFILE:process.env.SIGNAL_INSTANCE_PROFILE}:{}),SIGNAL_MODE:mode,SIGNAL_SERVE_STATIC:'1',SIGNAL_DB_PATH:config.dbPath,SIGNAL_FRONTEND_PORT:String(config.frontendPort),SIGNAL_API_PORT:String(config.apiPort)};
// Service managers do not inherit the foreground launcher's model settings.
// Preserve only explicit Codex configuration, never the whole process environment.
for(const key of ['SIGNAL_CODEX_BIN','SIGNAL_CODEX_MODEL','SIGNAL_CODEX_EFFORT','SIGNAL_CODEX_TIMEOUT_MS'])if(process.env[key]!==undefined)env[key]=process.env[key];
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
