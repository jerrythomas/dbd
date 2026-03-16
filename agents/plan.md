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
