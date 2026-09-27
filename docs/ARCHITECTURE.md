# 架构与能力边界

React/Vite 页面通过同源 `/api` 代理访问 Node HTTP 服务。SQLite 保存新闻修订、研究版本、证据材料、初筛样本与模拟账本，后台调度按来源分别冷却、缓存并记录错误。

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 工作台 | `prototype/src/integrated` | 事件、公司日线、审批与持仓 |
| API 边界 | `prototype/server/index.mjs` | 本地 Host/Origin、请求格式、健康检查与路由 |
| 运行模式 | `prototype/server/runtime.mjs`、`demo.mjs` | 数据库模式隔离与原创合成演示 |
| 数据 | `store.mjs`、`providers.mjs`、`daily.mjs` | 修订记录与新闻/行情适配，不保证实时供应 |
| 研究 | `research.mjs`、`research-materials.mjs`、`triage.mjs` | 版本化材料、人工分析和标题初筛 |
| 模拟 | `paper.mjs`、`workflow.mjs` | 人工批准、资金占用、过期与复核 |
| 共享规则 | `prototype/shared` | 公司身份、概率主张、交易日历与规则目录 |
| 测试 | `prototype/tests` | 内存/临时 SQLite 与合成输入，无私人数据依赖 |

历史研究使用当时可用时间；缺少首次获取时间的回溯只能标注假设。版本化输入和结果不得被新规则覆盖。传闻可参与，但消息概率、盈利兑现与价格上涨概率是不同问题。

模拟引擎使用冻结场景价、假设 FX 和简化费用，不把供应商行情接进净值。审批不会调用券商。自动全文模型、真实执行约束和独立长期验证尚未实现。

`research-seeds.mjs` 保留旧开发模式的历史回溯样例，仅用于兼容和测试；它们是研究记录，不是经过本轮事实核验的新闻数据库。默认离线模式仅使用 `demo.mjs` 的合成内容；空白研究模式不导入它们。
