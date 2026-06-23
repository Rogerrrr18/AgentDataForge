# AgentDataForge

AgentDataForge is a standalone data-production engine for AI Agent teams. It discovers public datasets and benchmarks, harvests their schema, estimates benchmark readiness, and generates portable eval dataset manifests.

The project is intentionally separate from Zeval:

- AgentDataForge produces eval data, benchmark packs, and schema manifests.
- Zeval consumes eval data to run quality evaluation, replay, bad-case mining, and remediation loops.

## MVP Pipeline

```text
search query
  -> source connectors
  -> candidate catalog
  -> schema completeness profiler
  -> benchmark manifest
  -> exportable dataset package
```

## First CLI

```bash
npm install
npm run forge -- discover "customer support agent benchmark" --source huggingface --limit 5
npm run forge -- manifest examples/minimal-cases.jsonl
npm test
```

## What This Is For

Agent builders need data that is richer than prompt-response pairs:

- task instructions
- expected outputs
- rubrics
- deterministic checkers
- tool traces
- environment state
- provenance and license metadata

AgentDataForge starts by measuring what a dataset already has, then creates a manifest that makes gaps explicit instead of hiding them behind a flat CSV.

## Relationship To Evolvent-Style Data Infrastructure

Evolvent-like companies solve the problem of high-signal Agent data: benchmarks, long-horizon task environments, trajectories, and training/eval datasets. AgentDataForge aims at the practical entry point: turning open data and customer-specific task descriptions into benchmark-ready assets.

## Current Scope

Included in v0.1:

- Hugging Face and GitHub metadata discovery.
- Industry/domain taxonomy seeded from Zeval BenchHub ideas and expanded for Agent datasets.
- Schema completeness scoring for task, gold, context, trace, environment, provenance, and license fields.
- Benchmark manifest generation from JSONL cases.

Not included yet:

- Full sandbox execution.
- Large binary dataset mirroring.
- Human annotation UI.
- Production database persistence.
