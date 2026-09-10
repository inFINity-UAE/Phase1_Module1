---
name: document-feature
description: Write engineer-and-stakeholder documentation for a feature that already exists. Use when the user says "Document this feature" or "write docs for X".
---

# Document a feature

Document **current** behavior only. If it is not in code/`schema.sql`/tests, mark it Planned/Reserved — never as Complete.

Audience: engineer **and** non-engineer. Lead with what a user/accountant can do.

## Before writing

1. Find the owning feature spec and decision numbers.
2. Trace controller → service → RPC/table.
3. Read tests for error cases and permissions.
4. Check `.cursor/references/source-of-truth.md` so you do not copy stale manual text.

## Sections (omit if N/A, do not fabricate)

- What it does / why it exists
- User workflow (API operations, not fictional screens)
- Business behavior
- Accounting impact (accounts, JE types, balance, periods)
- Data flow
- Database (tables, RPCs, triggers)
- API (method, path, required `company_id`, actor)
- Validation and error tokens
- Permissions (membership + Owner/Manager where relevant)
- Example request/response **from tests or real DTO fields**
- Tests that lock the behavior
- Known limitations / deferrals

Keep the module spec the standing rule document. A new markdown file is only if the user asked for one; otherwise update the spec’s descriptive sections without rewriting decision-log history.
