# Business Brief

## Product Definition

AgentDataForge is an Agent data factory: it finds, normalizes, enriches, and packages benchmark/test-set data for AI Agent teams.

## Customer Need

Agent teams are moving beyond single-turn prompts. They need datasets that can test:

- multi-step task completion
- tool-use correctness
- retrieval grounding
- state tracking
- workflow safety
- permission boundaries
- long-horizon reliability

Most public datasets are not directly usable for this. They are scattered across repositories, have inconsistent schema, weak licensing metadata, missing expected outputs, and almost never include executable checkers.

## Product Wedge

The first wedge is Benchmark Schema Harvesting:

1. Discover public datasets and benchmark repos.
2. Inspect their metadata and samples.
3. Score schema completeness.
4. Generate a manifest with input schema, expected schema, evaluator candidates, risk tags, and missing fields.
5. Package usable subsets into eval-ready JSONL.

## How It Differs From Zeval

Zeval evaluates AI application quality from chatlogs, traces, replay runs, and bad cases.

AgentDataForge produces the benchmark/test-set data that products like Zeval, internal eval harnesses, or Agent labs can consume.

## Commercial Products

- Standard benchmark packs by domain.
- Custom data production projects for enterprise Agent teams.
- Private data factory deployments that turn internal workflows into regression eval suites.
