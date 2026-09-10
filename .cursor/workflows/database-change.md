# Database change

Trigger: “Plan this database change”, new table/RPC/trigger/RLS, or editing `schema.sql`.

Never casually alter production-critical structures. Prefer additive, idempotent, reversible changes. Fold into `schema.sql` (fresh-DB SoT). Do not add separate `apply_*.sql` patches.

## Before DDL

1. Affected tables, functions, triggers, RLS policies, indexes, FKs
2. Existing rows (posted JEs cannot be deleted — plan data backfill without breaking immutability)
3. Migration order (enums → tables → functions → policies → grants)
4. Rollback story (what cannot be undone: posted data, enum value removal)
5. Nest/API/DTO impact
6. Tests (integration against live DB; never TRUNCATE posted companies)

## Required on every new function

```sql
revoke all on function <fn> from public;
revoke all on function <fn> from authenticated;
revoke all on function <fn> from anon;
grant execute on function <fn> to service_role;
```

New tenant table: `enable row level security` + `company_isolation_*` policy + §12-style table grants to `service_role`.

New posting path: advisory lock namespace documented; lock order namespace-then-entry-number.

Views: `security_invoker = true`.

Money columns: `numeric(18,2)`.

## After

Checklist `.cursor/checklists/database-change.md`. Do not apply to production from the agent unless the user explicitly asks.
