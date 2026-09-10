# Accounting invariants

Use before claiming a ledger/AR/AP posting change is done.

- [ ] Posted JE Σ debit = Σ credit; unbalanced post rejected
- [ ] Drafts may be unbalanced until post
- [ ] No UPDATE/DELETE of posted lines/headers; reverse instead
- [ ] Cannot reverse twice; cannot reverse a reversal
- [ ] Opening balance once per company+FY; BS accounts only
- [ ] Year-end once per company+FY; target 3100; P&L via `is_ledger_truth_status`
- [ ] Period exists, same company, `entry_date` in half-open range; overlap impossible
- [ ] Soft-close honored; hard-close/reopen not invented
- [ ] Accounts same-company + active; system accounts not structurally mutated
- [ ] Account numbers from COA/spec, not invented
- [ ] Document posting uses existing RPC (issue/void/payment/write-off/ECL)
- [ ] Reports/year-end ignore draft/pending/rejected
- [ ] Approval rules: Owner bypass; write-off vs journal threshold; ECL non-blocking
- [ ] `company_id` isolation on every read/write
- [ ] Audit trail: status_change/reversal; posted delete attempts → `delete_blocked`
- [ ] Tests cover happy + unbalanced + closed period + wrong company + double-post/double-reverse where applicable
