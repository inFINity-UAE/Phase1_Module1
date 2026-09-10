---
name: code-review
description: Review diffs for defects, accounting correctness, tenant isolation, and tests — not style. Use when the user says "Review this", "review these changes", or "code review".
---

# Code review

Review the actual diff (uncommitted, branch, or named files). Prioritize defects and risks over style. Ponytail still applies: do not request abstractions nobody asked for.

## Order

1. Correctness vs the owning module spec and `schema.sql`
2. Accounting (balance, immutability, account numbers, periods, ledger-truth)
3. Security (guards, actor from session, `company_id` filters, RLS/grants)
4. Database (constraints, RPC vs Nest, locks, numeric)
5. Tests (new branches, negatives, auth coverage list)
6. Architecture fit (existing layers, no second scheduler, no posting reimplementation)
7. Docs / decision-log impact
8. Backwards compatibility of HTTP/RPC contracts

## Output

Use `.cursor/templates/code-review.md`.

- 🔴 Must fix before merge
- 🟡 Real risk or spec mismatch, not blocking if acknowledged
- 🟢 Optional / nit — keep sparse

Cite files. Do not invent issues. If you did not run tests, say so.
