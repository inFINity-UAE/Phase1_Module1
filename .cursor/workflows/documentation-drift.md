# Documentation drift

Trigger: “Check documentation drift”.

Compare, for the named scope (or modules A/H1/C/D/E if unspecified):

| Source | Treat as |
|---|---|
| Accounting Rules PDF + owning feature spec standing sections | Business rules |
| `schema.sql` | DB truth |
| `src/` | Implementation truth |
| Tests | Asserted truth |
| README, `INFINITY_ACCOUNTING_DOCUMENTATION.md`, old §7.2 counts | Narrative — often stale |

Start from `.cursor/references/source-of-truth.md` (known conflicts). Then search for new ones.

## Report format

```
### DRIFT-n
Authoritative: <spec/schema/code>
Others: <doc> says X; <code> does Y
Evidence: …
Risk: …
Recommend: update <file> to match <authority>  OR  raise as product gap
```

Examples of the shape to look for:

- Spec says X, code does Y
- Docs say X, database enforces Y
- Tests expect X, implementation behaves Y

Do not “fix” drift by changing accounting rules to match a stale README.
