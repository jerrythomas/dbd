# Complexity Reduction — Design Spec

## Goal

Bring all functions with cyclomatic complexity > 10 below 10 by extracting named helper
functions. No new files, no restructuring — surgical extractions only.

## Approach

Extract named helpers from:

- Large arrow callbacks inside `.map()` / `.filter()`
- Long if/else chains that branch on a type discriminant
- Nested loop bodies that can be isolated

All changes are within-file. No public API changes.

## Files and Extractions

### Group 1 — Translators

| File                          | Function (complexity)                    | Extract                                                       |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `translators/create-table.js` | `translateCreateStmt` (25)               | `applyTableForeignKey(col, con)`, `applyTablePrimaryKey(col)` |
| `translators/create-table.js` | `translateColumnConstraints` switch (14) | `buildForeignKeyConstraint(con)`                              |
| `translators/create-view.js`  | `translateTargetExpr` (20)               | `translateColumnRef(fields)`                                  |
| `translators/where-expr.js`   | `translateWhereExpr` (15)                | `translateAConst(ac)`                                         |
| `translators/types.js`        | `resolveDefaultExpr` (15)                | `resolveAConstDefault(ac)`                                    |

### Group 2 — Extractors

| File                       | Function (complexity)           | Extract                                                                                                    |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `extractors/tables.js`     | `extractComments` (45)          | `processTableComment(stmt, comments)`, `processColumnComment(stmt, comments)`, `resolveCommentValue(expr)` |
| `extractors/tables.js`     | `extractColumnConstraints` (22) | `extractFKFromRefDef(columnDef)`, `extractFKFromConstraintList(constraints)`                               |
| `extractors/views.js`      | `extractViewDependencies` (14)  | `collectCteDependencies(selectWith, collectFromDeps)`                                                      |
| `extractors/views.js`      | `extractViewColumns` (12)       | `resolveColumnName(col)`, `resolveColumnSource(col)`                                                       |
| `extractors/db-indexes.js` | `extractIndexColumns` (12)      | `resolveIndexColumnName(col)`                                                                              |
| `extractors/db-indexes.js` | `extractTableName` (11)         | Early-return simplification (no new helper needed)                                                         |
| `extractors/procedures.js` | parameter-parse arrow (13)      | `parseRawParameter(paramStr)`                                                                              |

### Group 3 — index-functional.js

| Function (complexity)    | Extract                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `identifyEntity` (28)    | `extractEntityInfo(keyword, createStmt)`                                                                              |
| `collectReferences` (22) | `collectTableFKRefs(tables)`, `collectViewRefs(views)`, `collectProcRefs(procedures)`, `collectTriggerRefs(triggers)` |

### Group 4 — Other packages

| File                      | Function (complexity)   | Extract                                                          |
| ------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `dependency-resolver.js`  | `subgraphEntities` (16) | `buildReverseGraph(entities)`, `bfsVisit(name, lookup, reverse)` |
| `entity-processor.js`     | `validateEntity` (16)   | `validateEntityReferences(entity, ignore)`                       |
| `psql-adapter.js`         | `applyEntity` (11)      | `buildDryRunMessage(entity)`                                     |
| `reference-classifier.js` | `isExtension` (11)      | `extensionMatchesInput(extension, input)`                        |

## Success Criteria

- `bun run test` — all tests pass
- `bun run lint` — 0 errors, no complexity warnings > 10
