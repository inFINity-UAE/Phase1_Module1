---
name: gap-audit
description: Systematic gap audit of a module or scope — missing features, spec/code mismatch, RLS, tests, stubs. Use when the user says "Run a gap audit", "gap analysis", or "what's missing in Module X".
---

# Gap audit

Do not start implementing. Inspect the requested scope and report only **evidenced** gaps.

## Scope

If the user names a module, use that spec + matching `src/` + `schema.sql` sections. If unspecified, ask once or default to the files in the current diff / conversation.

Read `.cursor/references/source-of-truth.md` first so stale docs are not reported as product bugs without noting authority.

## Inspect

For the scope, search (do not rely on filenames alone):

- Feature spec standing rules vs code vs tests
- `schema.sql` tables, CHECKs, triggers, RLS, grants, RPCs
- Nest controllers/services/repositories/DTOs
- Auth: every route guarded? `CompanyResourceKind` complete? `verify-auth-module-imports.mjs` list
- TODOs, `not implemented`, empty methods, `Partial` stubs
- Error mapping for new RAISE tokens
- Deferred items listed as out-of-scope — **not gaps** unless the user asked for completeness against a later module

## Finding bar

No finding without evidence (file + line/symbol, or a spec citation plus the missing symbol). If you cannot show current vs expected, it is not a finding.

Do not call a documented deferral (C §9, D §7, hard-close HTTP, Module E) a gap unless the request was “vs the full product vision.”

## Severity

| Level | Use when |
|---|---|
| CRITICAL | Cross-tenant access, unbalanced posted JE, posted-row mutation, secret exposure, silent data loss |
| HIGH | Spec/code mismatch on a standing rule, missing RLS on a new table, missing membership on a new route, posting without RPC/lock |
| MEDIUM | Missing tests for a real branch, weak assertions, missing grant checklist, error-token unmapped |
| LOW | Naming inconsistency, missing comment citation, dead code |
| INFORMATIONAL | Stale README counts, documented stubs, known D-P13 mock compile gap |

## Output

Use `.cursor/templates/gap-finding.md` for each finding. Then a summary table sorted CRITICAL → INFORMATIONAL.

If the scope is clean, say so and list what you checked.
