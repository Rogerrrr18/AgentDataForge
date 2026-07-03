# AgentDataForge

AgentDataForge 是一个面向 AI Agent 团队的数据生产引擎。它用于发现公开数据集和 benchmark，抽取与评估数据 schema，判断一份数据距离“可用于 Agent 评测”的成熟度，并生成可移植的 eval dataset manifest。

这个项目刻意与 Zeval 分层：

- AgentDataForge 负责生产 eval 数据、benchmark pack 和 schema manifest。
- Zeval 负责消费 eval 数据，执行质量评估、回放、bad case 挖掘和修复闭环。

## MVP 流程

```text
搜索查询
  -> 数据源连接器
  -> 候选数据目录
  -> 行业细分
  -> schema 完整度评估
  -> 数据价值提升计划
  -> benchmark manifest
  -> 可导出的数据包
```

## 快速开始

```bash
npm install
npm run forge -- discover "customer support agent benchmark" --source huggingface --limit 5
npm run forge -- manifest examples/minimal-cases.jsonl
npm run forge -- manifest examples/customer-support-bench.jsonl
npm run finance:pack
npm run ui:build
npm test
```

`discover` 和 `manifest` 会附带：

- `industryProfile`：主行业、置信度、命中关键词和可包装的 Agent workflow。
- `enrichmentPlan`：当前数据价值层级、目标层级、预计 readiness 提升、自动化补值步骤和交付风险。

这样可以把 schema 很薄的公开数据变成可行动的资产：AgentDataForge 会解释一份候选数据目前只是 metadata、候选数据集、benchmark seed，还是已经接近 eval-ready/commercial pack。

## 项目要解决什么问题

Agent builder 需要的数据不只是 prompt-response 对，而是更丰富的任务结构：

- 任务指令
- 期望输出
- 评分 rubric
- 可确定执行的 checker
- 工具调用 trace
- 环境状态
- provenance 和 license 元数据

AgentDataForge 会先评估一份数据已经具备什么，再生成 manifest，把缺口显式暴露出来，而不是把问题藏在扁平 CSV 后面。

## 与 Evolvent 类数据基础设施的关系

Evolvent 这类公司解决的是高信号 Agent 数据问题：benchmark、长程任务环境、trajectory、训练/评测数据集。AgentDataForge 选择一个更可落地的入口：把公开数据和客户自己的任务描述，转化成可以用于 benchmark 的结构化资产。

## 当前已有能力

v0.1 已包含：

- Hugging Face 和 GitHub 元数据发现。
- 面向 Agent 数据集的行业/domain taxonomy。
- discovery 和 manifest 共用的行业细分能力。
- 对 task、gold、context、trace、environment、provenance、license 等字段的 schema 完整度评分。
- 针对缺失 gold output、rubric、checker、environment state、provenance、license review 的自动化数据价值提升计划。
- 从 JSONL case 生成 benchmark manifest。
- 客服 Agent benchmark seed pack。
- 金融研究数据包生成脚本和 dashboard 文档。

暂未包含：

- 完整 sandbox 执行。
- 大型二进制数据集镜像。
- 人工标注 UI。
- 生产级数据库持久化。

## 交付物示例

### 客服 Agent Benchmark

任务数据：

```text
examples/customer-support-bench.jsonl
```

说明文档：

```text
docs/customer-support-bench.md
```

覆盖场景包括退款处理、工单分流、企业客户升级、RAG 政策问答、隐私边界、物流查询、客户留存和多语言客服。每条 case 都包含 `input`、`context`、`expected`、`rubric`、`checker`、`trace`、`environment` 和 `metadata`。

生成 manifest：

```bash
npm run forge -- manifest examples/customer-support-bench.jsonl
```

### 金融研究 Data Pack

生成命令：

```bash
npm run finance:pack
```

主要产物：

```text
data/finance-research/
docs/finance-research-data-pack.md
docs/finance-research-dashboard.html
```

### 数据治理 UI

生成命令：

```bash
npm run ui:build
```

主要产物：

```text
docs/index.html
```

这个页面会扫描当前仓库已有的 taxonomy、benchmark、data pack 和文档文件，展示已支持场景、已入库数据、字段覆盖、预览样本和交付资产清单。

部署方式：

```text
.github/workflows/pages.yml
```

推送到 `main` 后，GitHub Actions 会重新生成 UI 并部署 `docs/` 目录到 GitHub Pages。

## 数据提供方案

AgentDataForge 的核心交付不是“原始数据条数”，而是一套可以被 Agent eval 系统消费的 benchmark pack：

```text
cases.jsonl
manifest.json
rubrics/
checkers/
fixtures/
provenance/license report
README.md
```

客户可以把这些数据接入自己的 Agent、eval harness 或 Zeval，在每次修改 prompt、模型、RAG、工具链或 workflow 后进行回归评测。
