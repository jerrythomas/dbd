# Plan: SQL Parser Modularization

## Context

`packages/postgres/src/parser/parsers/sql.js` has total complexity 227 with many functions exceeding 50.
Modularize by extracting all pgsql-parser AST translators into `translators/` directory.
Public API (`parse`, `splitStatements`, `validateSQL`, `parseSearchPath`, `initParser`) stays in `parsers/sql.js`.

## Approach

- Create `translators/` dir with one file per statement type
- Extract sub-functions to reduce individual function complexity
- `sql.js` imports `translatePgStmt` from `translators/index.js`
- All tests pass unchanged (they only import from `parsers/sql.js`)

## Steps

- [ ] Task 1: Create `translators/types.js` (PG_TYPE_MAP, resolveTypeName, resolveDefaultExpr)
- [ ] Task 2: Create `translators/create-table.js` (translateColumnDef + translateTableConstraint + translateCreateStmt + helpers)
- [ ] Task 3: Create `translators/where-expr.js` (translateWhereExpr, translateFromItem, flattenJoinExpr)
- [ ] Task 4: Create `translators/create-view.js` (translateViewStmt + translateTargetExpr extracted)
- [ ] Task 5: Create `translators/create-function.js` (translateCreateFunctionStmt + extractFunctionOptions + translateFunctionParameter)
- [ ] Task 6: Create `translators/create-index.js`, `create-trigger.js`, `variable-set.js`, `comment.js`
- [ ] Task 7: Create `translators/index.js` (translatePgStmt dispatcher)
- [ ] Task 8: Rewrite `parsers/sql.js` to import from translators, add scanDollarTag helper
- [ ] Task 9: Run full test suite + lint — both must pass
- [ ] Task 10: Commit

## Verification

`bun run test && bun run lint` — all pass, 0 lint errors
