# Cursor engineering system (inFINity Phase 1)

Turns Cursor into a disciplined partner for this **NestJS + Supabase** UAE ledger — not a generic codegen bot.

Existing always-on rules **kept**: `rules/ponytail.mdc` (smallest correct change), `rules/accounting-engine.mdc` (never invent accounting; cite SoT). The latter’s module list was updated to match Build Order (A/H1/C/D built, E specified) without relaxing never-guess / schema / `numeric(18,2)` rules.

## Layout

```
.cursor/
  rules/          persistent principles (always-on vs glob/description)
  skills/         specialist tasks (gap audit, reviews, docs, …)
  workflows/      multi-step processes
  checklists/     verification
  templates/      output shapes
  references/     project map + SoT conflicts (load on demand)
  README.md       this file
```

## Always-on (keep this set small)

| File | Job |
|---|---|
| `ponytail.mdc` | YAGNI, reuse, smallest correct diff |
| `accounting-engine.mdc` | SoT priority, never guess, module gate |
| `00-global.mdc` | Impact analysis, routing table, report format |
| `01-project-context.mdc` | What exists (API-only, module status) |

Other `0x-*.mdc` files apply via **globs** or **description** when the task matches. Do not copy their text into always-on rules.

## Day-to-day

| You type | Cursor should |
|---|---|
| `Implement feature X` / `Build Module 1.1.E` | Workflow: understand → impact → plan → then code |
| `Run a gap audit on Module D` | Evidence-backed findings, severity, no invented gaps |
| `Audit the accounting engine` | Ledger invariants vs schema/spec/tests |
| `Review these changes` | Defects, accounting, tenant isolation, tests |
| `Check documentation drift` | Spec vs code vs schema vs stale README/manual |
| `Run regression audit` | Blast radius + smallest tests |
| `Plan this database change` | Tables/RPCs/RLS/grants/locks/rollback |
| `Document this feature` | What exists, including accounting impact |

## Source of truth (short)

PDF (policy) → `schema.sql` (DB) → owning module feature spec → code/tests. Sequencing: `Module_1.1_Build_Order_Scope.md`. Stale counts live in README / `INFINITY_ACCOUNTING_DOCUMENTATION.md` / old spec §7.2 — see `references/source-of-truth.md`.

## Adding to this system

- New **standing constraint** → a short rule (glob if file-specific).
- New **procedure** → workflow + optional thin skill with trigger phrases.
- New **facts** about the repo → `references/project-map.md`, not always-on rules.
- Do not duplicate ponytail or never-guess text.
