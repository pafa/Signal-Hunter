# Security · 安全说明

## 适用范围

信号猎手面向本地单用户研究。网页和 API 默认只监听 `127.0.0.1`；API 校验 Host/Origin、JSON 和请求体大小，正文读取限制地址、重定向、体积和超时。本工具没有账户认证、加密存储或多租户隔离，也没有券商下单接口。

请勿直接把端口映射到公网或无认证的共享网络。模拟批准按钮只记录工作流决定，不验证操作者身份；有权读取本机文件的进程可能访问数据库。

## 报告漏洞

仓库正式公开时，维护者应启用 GitHub 的 **Private vulnerability reporting**。启用后，可在仓库 **Security → Advisories → Report a vulnerability** 私密提交：

- 受影响版本、运行模式、操作系统与 Node 版本。
- 最小复现、可能影响和合成输入。
- 已知缓解措施（若有）。

如果该按钮不可用，请先提交不含漏洞细节的 issue，请维护者开启私密渠道；不要在公开 issue、PR 或附件中暴露可利用步骤、凭据或私人数据库。当前渠道是否已启用，以仓库设置和 [发布状态](docs/BACKLOG.md) 为准，不以本文件存在作为证明。

普通不敏感缺陷使用 Bug report 表单。依赖更新和发布前在 `prototype` 执行 `npm audit --audit-level=high`，结合运行路径判断影响。CI 同样检查已知高危 / 严重依赖告警；审计服务不可用属于未完成检查，不记为通过。中低等级结果也应审阅，命令退出成功不代表没有任何告警或完整安全认证。

## 支持状态

v0.11.0 为 early preview，目前没有承诺的安全维护周期。公网部署、多租户和完整渗透测试未验收。操作系统测试范围见任务清单。

## English

Signal Hunter is a local, single-user research tool. It does not provide authentication, encrypted storage, multi-tenant isolation, or broker execution. Do not expose its ports directly. Approval is a workflow decision, not proof of identity.

Once private vulnerability reporting is enabled, use the repository's **Security → Advisories → Report a vulnerability** flow. Include affected versions, a minimal synthetic reproduction, impact, and any mitigation. If the button is unavailable, ask for a private channel in a non-sensitive issue without disclosing exploit details. Never attach credentials or private databases. This early preview has no promised security support lifetime.

CI runs `npm audit --audit-level=high` against the locked dependency tree. High and critical advisories or an unavailable audit service block this check; a successful result is not a complete security assessment. Review lower-severity findings as well.
