# Architectural / accounting decision

Trigger: a change that would alter a signed-off decision, posting model, RLS model, immutability, or module boundary.

Do not implement until the user confirms.

## Capture

Use `.cursor/templates/adr.md`:

- Existing decision (id + spec citation)
- Proposed change
- Why
- Alternatives
- Consequences (accounting, security, migration, tests)
- Whether this is a new append-only decision-log entry (required if meaning changes)

## After approval

Append `A #n` / `H1 #n` / `C #n` / `D-n` / `E-n` to the **owning** spec. Do not rewrite the old entry’s body to mean something else.

E-1 (Bill = `bills` table) is closed — do not reopen when scoping B or E implementation.
