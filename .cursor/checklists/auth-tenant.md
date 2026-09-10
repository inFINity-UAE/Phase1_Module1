# Auth / tenant wiring (new `:id` or list route)

- [ ] `@UseGuards(SupabaseAuthGuard, CompanyMembershipGuard)`
- [ ] `@RequireCompanyMembership` source: `body` | `query` | `param` | `body_ref`
- [ ] If `param`/`body_ref`: `CompanyResourceKind` + repository `findCompanyIdBy…`
- [ ] List requires `company_id` query
- [ ] Fail-closed if decorator omitted
