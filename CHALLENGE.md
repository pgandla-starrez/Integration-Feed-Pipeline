# Integration Pipeline

## Your Deliverable

Produce two artifacts: a **written refactoring plan** and **working code** for your highest-priority fixes.

---

### Artifact 1 — Refactoring Plan

**Section A: Issue Register**  
List every problem you find. For each issue provide:
- A short title
- Severity: `Critical` | `High` | `Medium` | `Low`
- Category: `Security` | `Reliability` | `Data Integrity` | `Performance` | `Observability` | `Maintainability`
- Root cause — what is actually wrong, not just the symptom
- Business impact — what goes wrong for users or operations

**Section B: Prioritised Fix Order**  
Order your Critical and High issues by the sequence you would fix them in production. Justify why each comes before the next.

**Section C: Architectural Proposal**  
Describe the target architecture you would refactor toward:
- Codebase structure (layers, abstractions, interfaces)
- How you achieve idempotency across all three sync jobs
- How you handle side effects (e.g. emails triggered by sync data)
- What observability looks like after the refactor (logs, metrics, alerting)

**Section D: Migration Strategy**  
How do you ship the refactor incrementally without taking the service offline?

---

### Artifact 2 — Code

Implement fixes for the issues you ranked highest. You may restructure files, introduce new abstractions, or change the architecture — explain every decision.

Depth on a few issues is valued over shallow fixes across many.

---

## What Interviewers Are Looking For

- Do you identify **root causes**, not just surface symptoms?
- Do you prioritise by **business and operational impact**, not code aesthetics?
- Is your proposed architecture **explained and justified**, not just described?
- Do you think about **operational concerns** — deployment, rollback, monitoring?
- Do your code changes demonstrate **TypeScript discipline** — no `any`, proper interfaces?
- Do you ask the right **clarifying questions** about scale, infrastructure, and SLAs?
