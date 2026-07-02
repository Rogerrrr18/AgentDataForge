# Customer Support Agent Bench

## Definition

This seed benchmark targets customer-service agents that must classify tickets, answer policy-grounded questions, use support tools, respect privacy boundaries, and resolve multi-step workflow cases.

## Included Workflows

- Ticket triage and routing.
- Refund handling.
- Escalation.
- FAQ and policy grounding.
- Order tracking.
- Privacy and permission boundaries.
- Retention handling.
- Multilingual support.

## Scoring Surface

Each case is structured with:

- `input`: customer message and operational context.
- `context`: policy snippets or workflow rules.
- `expected`: gold intent, action, answer, plan, or state change.
- `rubric`: pass/fail criteria for human or LLM judging.
- `checker`: deterministic checker candidate.
- `trace`: expected tool/event sequence.
- `environment`: state fixture for order, queue, permission, or ticket assertions.
- `metadata`: domain, workflow, split, difficulty, license, and provenance.

## Commercial Gap

This pack is synthetic and redistribution-safe under its declared metadata license, but it should still be expanded before being sold as a production benchmark:

- Add more real enterprise workflows per vertical.
- Add executable checker adapters for each checker type.
- Add multi-turn transcripts with distractors and partial tool failures.
- Add customer-specific policy variants.
- Add reviewer calibration examples for rubric scoring.
