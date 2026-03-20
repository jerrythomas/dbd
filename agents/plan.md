# Plan: Auto-sequenced Import Plan — COMPLETE

All tasks executed and released as v2.2.0.

**Commits:** e6e1fe3, 01f224b, f76b378, d313a66, ae8d05d, 3244017 + v2.2.0 release tag

**Result:** `buildImportPlan` replaces broken `organizeImports`. Import procedures auto-called in dependency order. `loader.sql` eliminated. 809 tests passing.

See `agents/journal.md` (2026-03-20 entry) for full details.

---

**Previous plan archived here:**

# Plan: Complexity Reduction Pass 1 — COMPLETE

All 14 tasks executed. Commits: c4d4974, f7c277c, 5aff2dd, 7506f28

**Result:** Significantly reduced highest-complexity functions (45, 28, 22 → single-digit). 15 functions
remain > 10 in production code (down from 19+ in scope). Gap is due to ESLint counting `&&`/`||`/`??`/`?.`
operators which inflates complexity beyond what the plan estimated.

**Next phase (Pass 2):** Target remaining in descending order. Key candidates:

- `sql.js:41` splitStatements 36
- `extractors/tables.js` 5 functions at 12-14
- `translators/create-view.js:22` translateTargetExpr 14
- `translators/create-table.js:197` 13
- `extractors/procedures.js:219` 13
- `extractors/views.js:182` 14

See `agents/backlog.md` for Entity classes → Snapshots → Migrations phases.
