# Signal Hunter · 信号猎手

**From news developments to reviewable trading hypotheses.**

Signal Hunter is a local workbench for major-event research and paper-trading workflows across mainland Chinese A-shares, Hong Kong stocks, and US equities. It brings news, evidence, counter-evidence, related companies, daily charts, proposals, and position reviews into one research context.

It helps researchers ask: **What changed? Why might it matter? Which companies are exposed? What is already priced in? When should we act—or abandon the hypothesis?**

**v0.11.0 · Early preview · MIT · Local, single-user tool**

[简体中文](README.md) · English

[Quick start](#quick-start) · [Research workflow](#research-workflow) · [Capabilities](#current-capabilities) · [Documentation](#documentation-and-development) · [Contributing](CONTRIBUTING.md)

![Signal Hunter: event radar, research and multi-stock daily charts, proposal queue, and scenario positions](docs/assets/workbench.png)

*Screenshot from a development research instance. Its research, observed market prices, and scenario positions are not the default installation data or evidence of actual returns. The public package excludes that instance's database and original news archive. A new installation opens a separate synthetic demo.*

## Why Signal Hunter

A news item is not yet a trading signal. A development worth researching might be an acquisition, a regulatory decision, sustained product adoption, or several weaker clues pointing toward the same change. Effects may propagate through suppliers, customers, competitors, and markets.

Signal Hunter makes that reasoning inspectable and revisable:

- **Organize around events.** Screen developments first, then attach supporting evidence, counter-evidence, and unresolved material to events or composite themes.
- **Connect companies to the thesis.** Record relationship types, direction, and evidence; follow identified securities and compare daily charts side by side or on a common base.
- **Represent uncertainty.** Rumours can enter research. Keep the probability of a claim being true separate from business realization and price outcomes.
- **Make actions explicit.** Prepare open, add, reduce, or close proposals; the user approves or rejects them before the simulation proceeds.
- **Revisit the original reasoning.** New evidence and research versions feed position reviews while preserving earlier judgments and outcomes for later evaluation.

The tool is intended for individual researchers, event-driven strategy exploration, and developers building traceable research workflows. The application interface is currently mainly Chinese. Automated analysis and effectiveness evaluation remain under development.

## Quick start

Install **Node.js 24.15+ within the 24.x line** and its bundled npm. The recommended version is in [.nvmrc](.nvmrc). Dependency installation requires network access; the default demo does not request news, quotes, or model services at runtime.

Download and extract this repository, then open a terminal at its root:

```sh
cd prototype
npm ci --ignore-scripts
npm start
```

When the terminal reports that the workbench is ready, open [http://127.0.0.1:4178](http://127.0.0.1:4178/). Keep the terminal running; **Ctrl+C** stops both the web app and API.

The offline demo contains **3 fictional themes, 9 associated securities, synthetic daily charts, a USD 1,000,000 scenario book, 5 initial positions, and 3 pending proposals**. Real ticker symbols illustrate the three-market interface; the events and curves are synthetic. No account, API key, model service, or deposit is required.

A first walkthrough:

1. Select a fictional theme in the event radar and inspect its thesis, evidence, and counter-evidence.
2. Compare the related companies using the chart grid or common-base view, and inspect relationship evidence.
3. Switch to the portfolio view, labelled “组合巡检”, to inspect proposals, reserved cash, and positions; approve or reject a demo proposal.
4. Review the saved research and decision versions to see how the workflow preserves earlier judgments.

Demo changes persist across restarts. Run `npm run health` from another terminal in `prototype` to check the web app, API, and proxy. See the [operations guide](prototype/README.md) for port conflicts, backups, and starting a fresh demo.

## Start your own research

Stop the demo, then run this from `prototype`:

```sh
npm run start:research
```

Research mode uses a **separate, empty research database**. It imports no demo themes, watchlist, positions, or orders. Create a theme using “＋ 新建主题”, or turn a news item into a draft. The scenario book starts with USD 1,000,000 in illustrative cash.

| Mode | Command | Database, relative to the repository root | Inputs |
| --- | --- | --- | --- |
| Offline demo | `npm start` | `data/runtime/demo.sqlite` | Original synthetic fixtures; server-side external data requests disabled |
| Your research | `npm run start:research` | `data/runtime/research.sqlite` | Online news links, public quotes for followed companies, and on-demand material |

Research mode attempts to retrieve **Reuters headline links aggregated through Google News RSS** and public market data for followed companies. This is not an officially licensed Reuters API and carries no promise of real-time delivery, completeness, or continued availability. Article reading is on demand, with local storage. Check source status and timestamps in the app.

Database mode checks prevent opening an existing database in the wrong mode. See the [operations guide](prototype/README.md) for the compatibility-only `legacy` mode, port settings, and `SIGNAL_DB_PATH`. The launcher reads process environment variables; it does not automatically load `.env` files.

## Research workflow

**Inputs → events and themes → evidence → companies and charts → proposals → human decisions → position reviews → layered evaluation**

| Stage | Question | Current output |
| --- | --- | --- |
| Inputs and screening | When did we know? Is this worth further research? | Sources, first-seen timestamps, revisions, and title-screening samples |
| Structured research | What supports the claim? What would invalidate it? | Events or themes, evidence and counter-evidence, claims, probabilities, and research versions |
| Companies and charts | Who is exposed? What has price reflected? | Relationship evidence and revisions, a focused watchlist, and comparable daily charts |
| Hypotheses and proposals | When should we act, hold, or stop? | Triggers, invalidation conditions, expected holding periods, quantity/limit/expiry, and risk checks |
| Human decisions and simulation | Do we accept this version and these conditions? | Approval/rejection/expiry records, scenario fills, cash, and positions |
| Review and evaluation | Does the thesis still hold? Is the method useful? | Review records and new proposals; an evaluation protocol, with full automated evaluation still planned |

### Product logic map

![Eight-stage product map of Signal Hunter, from inputs and evidence to approval, review, and evaluation; labels are in Chinese](docs/assets/product-logic.png)

[Open the full-resolution map](docs/assets/product-logic.png). Its labels distinguish **implemented, partial, scenario-only, and planned** capabilities. They describe implementation scope, not proven trading performance. See [image notes](docs/assets/README.md) for context.

## Current capabilities

| Available | Boundary |
| --- | --- |
| Title-rule screening, news search, and manual missed-event review | No automatic full-text semantic analysis, cross-report clustering, or validated detection accuracy |
| Versioned evidence, material, research, claims, and counter-evidence | Analysis is primarily manual; material packs support human or conversational review without automatic model invocation |
| A-share / Hong Kong / US company relationships and automatic following | The company catalog is limited; identities, exposure, and cross-market mappings need review |
| Daily chart grids, common-base comparison, and minute-data observation | Public sources may be delayed or incomplete; adjustment, calendar, and provider differences need validation |
| Proposals, human decisions, risk checks, and position review | Frozen scenario prices, fixed FX, and simplified fees; observed quotes do not drive book NAV |
| Input samples, version history, and an evaluation protocol | Independent holdout metrics, probability calibration, and strategy return validation are unfinished |

Scenario fills exercise the workflow. They do not model real liquidity, partial fills, settlement restrictions, price limits, or complete taxes and fees. **There is no broker order integration. Passing tests, screenshots, and retrospective examples do not establish profitability or strategy validity.**

The app is local and single-user, listening on `127.0.0.1`. Approval is a workflow action, not identity authentication; do not expose the ports directly. Read the [security policy](SECURITY.md) and the [data policy](docs/DATA-POLICY.md).

## Documentation and development

The workbench uses **React + Vite**, a **Node.js HTTP API**, and **Node's built-in SQLite**. The frontend reaches the API through a same-origin `/api` proxy. Inputs, research, and simulation decisions retain versions. No separate database server is needed.

| Document | Contents |
| --- | --- |
| [Operations guide](prototype/README.md) | Commands, ports, modes, backups, and troubleshooting |
| [Architecture](docs/ARCHITECTURE.md) | Module responsibilities, data flow, and boundaries |
| [Research rules](docs/MAJOR-EVENT-SYSTEM.md) | Materiality, transmission, proposals, review, and exits |
| [Evaluation protocol](docs/EVALUATION-PROTOCOL.md) | Availability time, event isolation, baselines, and holdouts |
| [Backlog](docs/BACKLOG.md) / [Decisions](docs/DECISIONS.md) | Canonical progress and decisions |
| [Changelog](CHANGELOG.md) | Version scope and release notes |
| [Contributing](CONTRIBUTING.md) | Development, checks, and pull requests |
| [Source releases](docs/OPEN-SOURCE.md) | Reviewable exports, checksums, and publication steps |

Most detailed documentation is currently in Chinese. Run the development checks from `prototype`:

```sh
npm test
npm run build
npm run release:check
```

Upcoming priorities include company-level impact and alternative explanations, event-detection evaluation, position risk review, and simulation under real market constraints. The [backlog](docs/BACKLOG.md) tracks status and dependencies. Reproducible issues, synthetic examples, and focused PRs are welcome.

## License

Original software and documentation are licensed under the [MIT License](LICENSE), copyright Signal Hunter contributors. Third-party news, market data, trademarks, and dependencies retain their own rights; MIT does not automatically grant redistribution rights for them. See [third-party notices](THIRD_PARTY_NOTICES.md) and the [data policy](docs/DATA-POLICY.md).
