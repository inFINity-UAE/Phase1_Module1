# Security (when touching auth, RLS, DTOs, or tenant data)

- [ ] Bearer JWT required
- [ ] `CompanyMembershipGuard` + `@RequireCompanyMembership` on every new route
- [ ] Actor ids from session, not body
- [ ] Update DTO cannot set `company_id`, role, status machine fields, or system flags
- [ ] Resource `:id` resolved to `company_id` then membership (403 if non-member)
- [ ] Repository filters `company_id` (service_role bypasses RLS)
- [ ] New table has RLS + policy; new RPC revoke anon/authenticated/public
- [ ] No secret key in client-side or logs
- [ ] `controller-auth-coverage.spec.ts` updated
- [ ] Module imports `AuthModule`; `verify-auth-module-imports.mjs` would pass
- [ ] Negative test: other-company id → 403/404 as existing pattern
