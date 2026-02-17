# Design Patterns

Established patterns cookbook. Reference this file before implementing new features to ensure consistency.

---

## 1. Three-Layer Parser

**Context:** When extracting schema information from SQL.

**Pattern:**
1. SQL Parsing (`parsers/sql.js`) — split SQL into statements, generate AST via `node-sql-parser`
2. AST Extraction (`extractors/`) — specialized extractors per object type (tables, views, procedures, indexes)
3. Functional API (`index-functional.js`) — high-level composition of extraction functions

**Data flow:**
```
SQL Text -> Parse -> AST -> Extract -> Schema Objects -> Transform -> Output
```

**Used in:** `packages/parser/src/`

---

## 2. Fallback Extraction

**Context:** When AST parsing fails for unsupported SQL constructs.

**Pattern:**
- Each extractor attempts AST-based extraction first
- On failure, falls back to regex-based extraction from original SQL
- Errors are collected (not thrown) for later inspection
- Partial results are always returned

```
Parse Failure -> Original SQL -> Regex Extract -> Partial Schema -> Continue
```

**Used in:** All extractors in `packages/parser/src/extractors/`

---

## 3. Adapter Pattern (Database)

**Context:** When implementing database-specific operations.

**Pattern:**
- Common interface defined in `@dbd/db`
- Database-specific logic isolated in `adapters/{database}/`
- CLI orchestrates through the db abstraction, never talks to adapters directly

```
cli -> @dbd/db (interface) -> @dbd/db-postgres (implementation)
```

**Used in:** `adapters/postgres/`, `packages/db/`

---

## 4. Structured Error Objects

**Context:** When handling errors throughout the codebase.

**Pattern:**
- Use error objects with type, message, and context — not thrown strings
- Collect errors in result arrays for batch inspection
- Never use console.log/warn in library code — configurable logging only
- Graceful degradation: always return what you can

```javascript
const result = { tables: [], views: [], errors: [] };
try {
  result.tables = extractTables(sql);
} catch (error) {
  result.errors.push({ type: 'ParseError', message: error.message, sql });
  result.tables = extractTablesRegex(sql);
}
return result;
```

**Used in:** Parser package, error-handler.js

---

## 5. Function Composition

**Context:** When building complex operations from simpler ones.

**Pattern:**
- Prefer pure functions with clear input/output
- Use Ramda for composition utilities
- Build pipelines: `parse -> extract -> transform -> output`
- Keep side effects at the edges (CLI, adapters)

**Used in:** `packages/parser/src/index-functional.js`

---

## 6. Test Organization

**Context:** When writing tests for any package.

**Pattern:**
- `.spec.js` suffix, mirror source structure
- Arrange-Act-Assert pattern
- Fixtures in `spec/fixtures/` with realistic SQL
- Test both AST path and regex fallback path
- Test error conditions and edge cases

```
spec/
  fixtures/          # Shared SQL samples and expected outputs
  functional/        # End-to-end scenario tests
  {module}.spec.js   # Unit tests per module
```

**Used in:** All packages
