# 信号猎手 · Signal Hunter v0.11.0 · 运行与开发

项目定位、能力边界与首次体验见 [根目录 README](../README.md)。Node 24.15+（24.x），SQLite 使用 Node 内置模块；无需 Python、账户或 API 密钥体验离线演示。

## 命令

在本目录执行：

| 命令 | 作用 |
| --- | --- |
| `npm ci --ignore-scripts` | 按锁文件安装；首次需要 npm registry 网络 |
| `npm start` | 前台启动离线演示的网页与 API，Ctrl+C 结束 |
| `npm run start:research` | 空白研究库；独立保存主题、关注、持仓与申请，允许在线来源请求 |
| `npm run start:legacy` | 兼容旧开发模式与回溯种子；不建议首次体验使用 |
| `npm run health` | 检查网页、API 与代理是否均可用 |
| `npm run check` | 单元/接口测试与生产构建 |
| `npm run docs:design` | 重新生成规则阅读页 |
| `npm run release:check` | 检查发布允许清单、可疑凭据、本机路径与文档链接 |
| `npm run release:prepare -- /absolute/new-directory` | 导出发布候选；目录必须不存在，不提交、不上传 |

## 配置与端口

启动脚本读取进程环境变量，不自动加载 `.env`。开发低层命令 `npm run api` 默认沿用 legacy 模式；首次体验请用 `npm start`。

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `SIGNAL_FRONTEND_PORT` | 4178 | 本机网页端口 |
| `SIGNAL_API_PORT` | 4179 | 本机 API 端口，与网页不同 |
| `SIGNAL_DB_PATH` | 按模式分配 | SQLite 路径，建议绝对路径；不可指向其他模式已有库 |

macOS/Linux 更换端口示例：

```sh
SIGNAL_FRONTEND_PORT=4278 SIGNAL_API_PORT=4279 npm start
```

随后在相同环境设置下运行 `npm run health`。PowerShell 使用 `$env:SIGNAL_FRONTEND_PORT="4278"` 等设置。启动器绑定 `127.0.0.1`，不会杀掉占用端口的现有进程，也不是长期驻留服务。Windows 尚未实机验收。

## 故障排查

- 网页打不开：检查启动终端是否仍在运行，用 `npm run health` 分辨网页/API/代理故障。
- 端口占用：保留原服务，使用另一对端口；不要随意结束未知进程。
- SQLite 模块或依赖报错：检查 `node --version`；支持 Node 24.15+ 的 24.x。
- 新闻/行情缺失：先看来源状态和时间戳；网络失败时保留缓存，不用演示曲线冒充行情。
- 离线演示读取外部正文被拒绝：这是预期行为；自己的研究请使用研究模式。
- 重开演示：已有演示操作继续保存，不自动重置。要一个全新演示，可将 `SIGNAL_DB_PATH` 指向未使用的新文件。不要删除自己的研究数据库。
- 历史近15日测试报告不随公开包提供；当前页面已移除依赖该私人报告的入口。

## 数据保护

运行数据位于项目根目录 `data/runtime` 并被 Git 忽略。备份时先正常停止该实例，再复制数据库及其同目录文件，避免 SQLite WAL 的不完整快照。不要把数据库、`.env`、日志或含私人材料的截图放进 issue/PR。

演示与研究的数据库模式标记不构成跨进程的安全隔离：有权读取本机文件的人仍可读取数据。本工具不提供账户、加密存储或公网访问控制。

## 生产运行候选

使用 `npm run build` 后执行 `npm run start:production`，同源页面/API 使用网页端口。任务暂停与运行记录持久保存，新增一致备份及恢复确认。完整命令、控制边界和未验收项见[本机生产运行与恢复](../docs/DEPLOYMENT.md)。

已有研究不要依赖各源码副本的默认数据路径。请按[固定已有研究入口](../docs/DEPLOYMENT.md#固定已有研究入口)登记配置，再使用 `npm run start:instance -- <配置绝对路径>` 启动。路径不存在或历史指纹不符时停止，不会创建另一个空库。配置不替代代码升级前的备份与兼容性审阅。
