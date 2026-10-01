# Changelog

记录对使用者有影响的功能、边界与运行方式；研发任务状态见 [任务清单](docs/BACKLOG.md)。

## Unreleased · 2026-10-01

- 运行基础与研究导航已合并主干：生产静态入口、持久采集、来源控制、备份恢复、公司抽屉与关注表格。
- 事件追踪候选：跨报道召回、历史研究对照、持仓风险复核顺序；关联、排除及撤销均留存决定。
- 输入与规则变更保留旧记录，来源家族和行业类比分开；不自动升级证据、下单或修改场景账本。
- 本轮未部署远程服务、迁移个人库或提供市场行情驱动的模拟收益。

## v0.11.0 · Early preview candidate

首次源码公开候选，准备日期 2026-09-27；此记录不是已经发布的 Git tag 或 Release。

### 工作台与研究

- 本地单屏组织事件雷达、研究、关联公司日线、行动队列与模拟持仓。
- 面向 A 股、港股、美股；维护有限公司目录、关系依据/方向/修订及重点关注。
- 标题规则初筛、完整新闻检索、漏筛复核与分层留样。
- 版本化材料、证据与反证、研究假设、主张概率和持仓复核。
- 建仓、增仓、减仓与清仓申请，由本人决定后进入场景模拟。

### 首次运行与源码分发

- 默认离线虚构演示；独立空白研究模式，不分发个人数据库。
- Node 24.x、锁定依赖、启动器、双端口健康检查与模式冲突保护。
- MIT、第三方声明、中文与英文 README、产品逻辑图和开发实例截图。
- 贡献/安全指南、Issue 表单、PR 模板、基础 CI 与发布允许清单。
- 导出包含逐文件 SHA-256 清单；不包含运行库、凭据、原始新闻档案或私人材料。

### 已知边界

自动全文研判、完整证券主表、市场行情驱动的模拟撮合与净值、独立样本效果评估尚未完成。当前为冻结场景价格、固定 FX、简化费用的流程演练；不是实盘交易系统，也没有经过验证的收益承诺。

English: this early preview candidate includes a local event-research workbench, versioned evidence and company relationships, daily charts, human-approved scenario trading, an offline synthetic demo, and a separate empty research mode. It does not yet provide automatic full-text analysis, market-based execution or NAV, or independently validated strategy performance. Publication and platform verification status are tracked in the backlog.
