# 数据生成引擎 (Synthesis Engine)

AgentDataForge 的第三层能力：用 LLM 按需求规格主动生成结构化的 agent eval 数据，而不是只从公开数据中发现。产出的每条 case 都符合 `BenchmarkCase` schema（`input` / `expected` / `rubric` / `checker` / `trace` / `environment` / `metadata`），可以直接回灌 `manifest` 命令重新评分，形成「生成 → 评估 → 再生成」的闭环。

这一层刻意把 LLM 解耦：provider 走 OpenAI 兼容接口，你用自己的 API key 和 endpoint 配置即可。

## LLM 配置

通过环境变量配置（无需改代码）：

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 是 | 你的 provider API key |
| `LLM_MODEL` | 是 | 模型 id，如 `gpt-4o-mini`、`deepseek-chat`、`qwen-plus`、`glm-4-flash` |
| `LLM_BASE_URL` | 否 | OpenAI 兼容端点，默认 `https://api.openai.com/v1` |
| `LLM_TEMPERATURE` | 否 | 采样温度，默认 `0.8`（生成需要多样性） |
| `LLM_TIMEOUT_MS` | 否 | 单次请求超时，默认 `60000` |
| `LLM_JSON_MODE` | 否 | 设为 `false` 可关闭 `response_format: json_object`（端点不支持时） |
| `LLM_EMBED_MODEL` | 否 | 语义去重用的 embedding 模型，默认回退到 `LLM_MODEL` |

大多数 provider（OpenAI、DeepSeek、通义、智谱、Moonshot、vLLM、Ollama）都说 OpenAI 的 `/chat/completions` 协议，所以通常只需要 `LLM_API_KEY` + `LLM_MODEL`。

## 三种用法

### 1. 从需求规格生成新 case

写一份 TaskSpec（JSON 或 YAML），描述你要什么数据：

```yaml
# examples/synth-specs/customer-support.yaml
name: customer-support-synth
industry: customer-service        # 必须是 taxonomy 里的合法 slug
taskType: tool_use
count: 10
mode: seeded                      # seeded | from-scratch
seedCases: ../customer-support-bench.jsonl   # seeded 模式必填，相对 spec 文件目录
fields: [input, expected, context, rubric, checker, trace, environment]
constraints:
  - "Cover refund, return, and escalation scenarios in roughly equal proportion."
diversity:
  personas: [angry customer, confused elderly user, enterprise account manager]
```

生成：

```bash
npm run forge -- synthesize examples/synth-specs/customer-support.yaml
```

两种 `mode`：

- **`seeded`**：从 `seedCases` 取 few-shot 示例，要求 LLM 生成同类但不重复的新 case（吸收 Evol-Instruct 思路，可叠加复杂度指令）。质量最稳，推荐在有种子数据时使用。
- **`from-scratch`**：不用种子，纯按 `industry` / `taskType` / `constraints` / `diversity.personas` 生成，persona 轮换保证多样性。

CLI 选项：

| 选项 | 作用 |
|---|---|
| `--limit N` | 覆盖 spec 里的 `count` |
| `--out path` | 输出路径，默认 `data/synthetic/<spec-name>/cases.jsonl` |
| `--judge` | 启用 LLM-as-judge 质量过滤 |
| `--dedupe` | 启用近重复去重（Jaccard） |
| `--max-tokens N` | token 预算上限，达到后提前停止 |
| `--dry-run` | 只打印 prompt 不调用 LLM（调试用，不需要 key） |

输出：`data/synthetic/<name>/cases.jsonl` + `generation-report.json`（生成了多少、过滤了多少、token 估算、用的哪个模型、跳过原因）。

### 2. 闭环补全已有数据

读一份已有 manifest 标出的缺口，逐条补全 case 缺失的字段（比如缺 `rubric`、`checker`、`license`），**保留所有原始字段不变**，只补缺失的部分。

```bash
# 先评估一份薄数据，得到 manifest
npm run forge -- manifest examples/minimal-cases.jsonl > /tmp/manifest.json
# 按 manifest 缺口补全
npm run forge -- synthesize --from-manifest /tmp/manifest.json --cases examples/minimal-cases.jsonl
```

这把 `enrichmentPlan` 从「计划」变成「执行」：manifest 告诉你缺什么，生成引擎直接补上，再回灌 `manifest` 就能看到 readiness 是否真的提升。

### 3. 预览 prompt（不调 LLM）

```bash
npm run forge -- synthesize examples/synth-specs/customer-support.yaml --dry-run
```

打印第一条会用的 system / user prompt，用于在不花 token 的前提下检查 prompt 拼装是否正确。

## 质量控制

生成管线（对应业界 QDC 框架：Quality / Diversity / Complexity）：

```
TaskSpec → 生成 → [judge 过滤] → [去重] → provenance 注入 → JSONL + report
```

- **LLM-as-judge**（`--judge`）：每条 case 由 LLM 按结构一致性打分（字段是否齐全、工具引用是否在 `trace.allowedTools` 和 environment fixture 里一致、rubric 是否可检查）。低于阈值丢弃；judge 本身出错时保留 case 并标记 `metadata.review = true`（绝不因为基础设施抖动丢数据）。
- **近重复去重**（`--dedupe`）：默认用 Jaccard token-set 相似度。需要语义级去重时可用 embedding 模式（`dedupeCasesByEmbedding` + cosine 相似度，配 `LLM_EMBED_MODEL`）。
- **token 预算**（`--max-tokens N`）：累计 token 达到上限即停止生成，report 里标 `stoppedByBudget: true`。

## provenance 与可追溯

每条合成 case 强制注入：

```json
"metadata": {
  "provenance": "synthetic",
  "generator": { "engine": "agent-data-forge", "model": "<model>", "specName": "<spec>" }
}
```

这样合成的数据永远可识别、可追溯，不会和真实数据混淆。

## 架构

```text
src/synthesis/
├── llm/
│   ├── types.ts             # LLMClient 接口（provider 无关）
│   ├── openai-compatible.ts # OpenAI 兼容实现（复用 connectors/http 的 fetchWithRetry）
│   ├── config.ts            # 从 env 读取配置、创建 client
│   └── embeddings.ts        # embedding client + cosine 相似度
├── spec.ts                  # TaskSpec + zod 校验 + JSON/YAML 加载
├── prompts/
│   ├── shared.ts            # 字段 schema 说明、JSON 输出约束
│   ├── seeded.ts            # 种子 few-shot prompt
│   ├── from-scratch.ts      # 纯需求驱动 prompt
│   └── field-completion.ts  # 闭环补全 prompt
├── parse.ts                 # LLM 输出 → BenchmarkCase 稳健解析（剥 fence/prose + 重试）
├── generate.ts              # 核心生成：调 LLM → 解析 → 重试
├── judge.ts                 # LLM-as-judge
├── dedupe.ts                # Jaccard + embedding 去重
├── enrich.ts                # 读 manifest 缺口、补全 case
└── pipeline.ts              # 编排：生成 → judge → 去重 → 输出 + report
```

复用现有模块：`BenchmarkCase` 类型、`schema-profiler`（评估生成结果）、`industry`（taxonomy 校验）、`zod`（spec 校验）、`connectors/http`（HTTP 重试）。

## 测试

全部测试用 mock LLMClient，不依赖真实 API、不需要网络：

```bash
npm test
```

覆盖 spec 校验、两种 prompt 构造、JSON 解析与重试、provenance 注入、judge 过滤、去重、闭环补全、token 预算早停、YAML 解析、cosine/embedding 去重。生成 → manifest 的闭环也有测试（验证补全后 readinessLevel 真的上升）。
