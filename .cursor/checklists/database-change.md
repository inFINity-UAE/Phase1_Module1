# Database change

- [ ] Change described in owning feature spec (or ADR workflow if new rule)
- [ ] `schema.sql` updated (canonical — no separate `apply_*.sql`)
- [ ] Enums/tables/FKs/indexes/triggers/RLS/grants ordered
- [ ] Function grant checklist (revoke public/authenticated/anon)
- [ ] `numeric(18,2)` for money; `timestamptz`; UUID PKs
- [ ] Advisory lock + order if check-then-act
- [ ] Existing posted data migration plan (no trigger disable)
- [ ] Nest repository/RPC wrappers + error tokens mapped
- [ ] Integration test on fresh-minted company
