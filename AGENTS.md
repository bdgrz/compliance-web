# Web client guidelines

This repository owns the Compliance web client. The backend lives in `bdgrz/compliance` and owns API behavior, authorization, tenant isolation, and the OpenAPI contract. Consume the pinned OpenAPI snapshot and generated client; do not reproduce backend authorization rules or depend on backend .NET projects.

## Build and test

Use Node 24 and the npm version pinned by `packageManager` in `package.json`. Run `npm ci` and `npm run check` (typecheck, lint, full unit suite, and build). The Vite development proxy expects a separately running backend at `http://127.0.0.1:5080`; the client build and unit suite must not require a backend checkout or running service.

For behavior changes, first add and run a focused failing unit test, then make the smallest passing change. Run the full check before review. Follow the existing TypeScript, TSX, and Vite conventions. End-to-end validation is a separately scoped later phase.

## Delivery boundaries

Work one small task at a time. Record the outcome, confirmed gap, owning issue, allowed files/behavior, exclusions, acceptance, and stopping point before coding. Architect, coder, and reviewer act sequentially. Limit discovery to 20 minutes; record and re-scope a directly blocking task at the boundary. Stop for a second workflow, unrelated refactor, unplanned API change, or another repository. Carry a handoff of at most 10 lines.

Ordinary issue PRs target the default branch, `develop`. Each change must be functional or use a feature flag that defaults off. A complex feature spanning several stories may use a bounded `feat/<feature>` branch, with story PRs into it and a final reviewed PR to `develop`. Sprints last 14 days, Wednesday through Tuesday, and need no integration branch. Link backend dependencies rather than combining repositories in one PR.

Review the immutable PR head for contract use, session handling, tenant boundaries, retries, and failure modes. Resolve verified findings, require final-head CI, squash merge, and read back the merged state. GitHub issues and the incremental product delivery project are authoritative. Jev may guide focused reversible decisions; it does not prove acceptance.

## Bootstrap boundary

The first import preserves all tracked `ui/` file bytes from backend commit `636f8cf43716a1f579c521a314368901665cb2c0`. Only repository guidance, ignore rules, licensing, provenance, and standalone client CI may be added. Do not fix authentication, upgrade packages, regenerate the API client, delete the backend copy, or add deployment/mobile work during import. If the baseline fails, record the exact blocker and select a separate focused task.
