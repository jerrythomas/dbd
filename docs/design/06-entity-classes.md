# 06 — Entity Classes

**Status:** Proposed
**Objective:** 1 of 3 (Entity Classes → Snapshots → Migrations)
**Depends on:** Parser switch to `pgsql-parser` (see `08-parser-switch.md`)

## Motivation

Entities are currently plain objects — `{ name, type, schema, file, refers, errors }`. The DDL file is treated as an opaque blob:

- Read once for dependency extraction (AST → just dependency names)
- Read again for execution (`ddlFromEntity()` → raw text)
- Read a third time for DBML generation (`@dbml/core` re-parses from scratch)

The parser already extracts rich structured data (columns, types, constraints, indexes, FK relationships) but the entity pipeline discards everything except dependency names. This means:

- No column-level validation
- No structured diff between schema versions
- No migration script generation
- DBML generation re-parses DDL unnecessarily

## Design Principles

1. **DDL files remain source of truth** — entity classes are parsed representations, never authoritative
2. **Parse once, use everywhere** — structured data from parsing serves validation, DBML, diffing, and execution
3. **Entity classes are value objects** — immutable after construction, no side effects
4. **Graceful degradation preserved** — if parsing fails, store raw DDL and fall back to current behavior
5. **Serializable** — every entity can round-trip to/from JSON for snapshot persistence

## Entity Class Hierarchy

```
ParsedEntity (base)
  ├── TableEntity         columns, constraints, indexes, FK relationships
  ├── ViewEntity          definition SQL, column aliases, dependencies
  ├── FunctionEntity      parameters, return type, language, raw body
  ├── ProcedureEntity     parameters, language, raw body
  ├── TriggerEntity       timing, events, table reference, function reference
  ├── RoleEntity          name, grants (refers)
  ├── SchemaEntity        name only
  └── ExtensionEntity     name, target schema
```

## Base Class: `ParsedEntity`

```javascript
class ParsedEntity {
  #type           // 'table' | 'view' | 'function' | 'procedure' | ...
  #name           // fully qualified: 'schema.entity'
  #schema         // schema name
  #file           // path to DDL file (null for generated entities)
  #rawDDL         // original DDL text (null for non-file entities)
  #searchPaths    // from SET search_path
  #refers         // resolved dependency names
  #errors         // validation errors
  #warnings       // unresolved reference warnings

  // --- Construction ---
  constructor({ type, name, schema, file, rawDDL, searchPaths, refers, errors, warnings })

  // --- Accessors (read-only) ---
  get type()
  get name()
  get schema()
  get file()
  get refers()
  get errors()
  get warnings()
  get isValid()        // errors.length === 0

  // --- Output ---
  toSQL()              // returns DDL string (reads from file or generates)
  toJSON()             // serializable representation for snapshots
  static fromJSON(obj) // reconstruct from snapshot data

  // --- Comparison ---
  diff(other)          // returns EntityDiff or null if identical
}
```

### Construction Flow

Entity classes are constructed **after** parsing, not instead of it. The flow:

```
DDL file
  → pgsql-parser.parse(content)     # AST
  → EntityFactory.fromAST(ast, file) # Typed entity class
  → entity.toJSON()                  # For snapshots
  → entity.toSQL()                   # For execution / combine
  → entity.diff(other)              # For migration generation
```

### Factory

```javascript
// packages/db/src/entity-factory.js
export function fromAST(stmts, file, searchPaths) {
  // Examine top-level statement type
  // Return appropriate entity class
  for (const { stmt } of stmts) {
    if (stmt.CreateStmt) return new TableEntity(stmt.CreateStmt, file, searchPaths)
    if (stmt.ViewStmt) return new ViewEntity(stmt.ViewStmt, file, searchPaths)
    if (stmt.CreateFunctionStmt)
      return functionOrProcedure(stmt.CreateFunctionStmt, file, searchPaths)
    if (stmt.CreateTrigStmt) return new TriggerEntity(stmt.CreateTrigStmt, file, searchPaths)
    if (stmt.IndexStmt) return new IndexEntity(stmt.IndexStmt, file, searchPaths)
  }
  // Fallback: return base ParsedEntity with raw DDL
}

export function fromConfig(type, name, options) {
  // For schema, extension, role entities created from design.yaml
  if (type === 'schema') return new SchemaEntity(name)
  if (type === 'extension') return new ExtensionEntity(name, options.schema)
  if (type === 'role') return new RoleEntity(name, options.refers)
}
```

## Type-Specific Classes

### TableEntity

The richest entity type — holds full structural metadata.

```javascript
class TableEntity extends ParsedEntity {
  #columns       // Column[]
  #constraints   // Constraint[]
  #indexes       // Index[] (from separate IndexStmt or inline)

  get columns()
  get constraints()
  get indexes()
  get primaryKey()     // shortcut: find PK constraint
  get foreignKeys()    // shortcut: filter FK constraints
  get uniqueKeys()     // shortcut: filter UNIQUE constraints

  // Output
  toSQL()              // deparse AST back to CREATE TABLE DDL
  toDBML()             // generate DBML for this table (no @dbml/core needed)
  toJSON()             // full structured snapshot

  // Comparison
  diff(other)          // → TableDiff { addedColumns, droppedColumns, alteredColumns, ... }
}
```

#### Column

```javascript
// Value object — not a class, just a typed shape
{
  name: string,
  type: string,           // 'integer', 'varchar(255)', 'numeric(10,2)'
  nullable: boolean,
  defaultValue: string | null,
  isPrimaryKey: boolean,
  isGenerated: boolean,
  identity: null | 'always' | 'by_default',
  comment: string | null
}
```

#### Constraint

```javascript
{
  name: string | null,     // named constraint or null
  type: 'primary_key' | 'foreign_key' | 'unique' | 'check' | 'exclusion',
  columns: string[],       // columns involved
  // FK-specific:
  referencedTable: string | null,
  referencedColumns: string[] | null,
  onDelete: 'cascade' | 'restrict' | 'set_null' | 'no_action' | null,
  onUpdate: 'cascade' | 'restrict' | 'set_null' | 'no_action' | null,
  // Check-specific:
  expression: string | null
}
```

#### Index

```javascript
{
  name: string,
  table: string,           // fully qualified table name
  columns: IndexColumn[],  // [{ name, order, nullsOrder }]
  unique: boolean,
  method: string,          // 'btree', 'hash', 'gist', 'gin', etc.
  where: string | null,    // partial index condition
  include: string[]        // INCLUDE columns
}
```

### ViewEntity

```javascript
class ViewEntity extends ParsedEntity {
  #definition    // the SELECT statement as SQL string
  #columns       // column aliases if specified
  #isReplace     // OR REPLACE flag
  #isRecursive   // RECURSIVE flag

  toSQL()        // CREATE [OR REPLACE] VIEW ... AS ...
  toJSON()

  diff(other)    // → ViewDiff { definitionChanged: boolean }
  // Views don't support ALTER — diff always means CREATE OR REPLACE
}
```

### FunctionEntity / ProcedureEntity

```javascript
class FunctionEntity extends ParsedEntity {
  #parameters    // Parameter[] — [{ name, type, mode, defaultValue }]
  #returnType    // string
  #language      // 'plpgsql', 'sql', etc.
  #body          // raw function body string
  #isReplace     // OR REPLACE flag

  toSQL()        // CREATE [OR REPLACE] FUNCTION ...
  toJSON()

  diff(other)    // → FunctionDiff { signatureChanged, bodyChanged }
  // Functions support CREATE OR REPLACE for body changes
  // Signature changes require DROP + CREATE
}

class ProcedureEntity extends ParsedEntity {
  // Same structure as FunctionEntity but no returnType
}
```

### TriggerEntity

```javascript
class TriggerEntity extends ParsedEntity {
  #tableName     // table the trigger is on
  #functionName  // function to execute
  #timing        // 'before' | 'after' | 'instead_of'
  #events        // ['insert', 'update', 'delete', 'truncate']
  #isRow         // row-level vs statement-level
  #columns       // for UPDATE OF columns
  #condition     // WHEN clause

  toSQL()        // CREATE TRIGGER ...
  toJSON()

  diff(other)    // → TriggerDiff — triggers don't support ALTER, always DROP + CREATE
}
```

### Config-Based Entities

These entities don't come from DDL files — they're constructed from `design.yaml` configuration.

```javascript
class SchemaEntity extends ParsedEntity {
  toSQL()  // CREATE SCHEMA IF NOT EXISTS {name};
}

class ExtensionEntity extends ParsedEntity {
  #targetSchema
  toSQL()  // CREATE EXTENSION IF NOT EXISTS "{name}" WITH SCHEMA {schema};
}

class RoleEntity extends ParsedEntity {
  #grants  // roles to GRANT to this role
  toSQL()  // DO $$ BEGIN CREATE ROLE ... END $$; + GRANT statements
}
```

## Integration with Existing Pipeline

### Where Entity Classes Fit

```
Current pipeline:
  entityFromFile() → parseEntityScript() → matchReferences() → sortByDependencies()
    → validateEntity() → ddlFromEntity() / generateDBML() / importScriptForEntity()

New pipeline:
  EntityFactory.fromFile(path) → entity.parseReferences() → matchReferences(entities)
    → sortByDependencies(entities) → entity.toSQL() / entity.toDBML() / entity.toJSON()
```

### Backward Compatibility

Entity classes implement the same interface the pipeline expects:

- `entity.type`, `entity.name`, `entity.schema`, `entity.file` — same accessors
- `entity.refers`, `entity.errors`, `entity.warnings` — same arrays
- `entity.toSQL()` replaces `ddlFromEntity(entity)` — same output

The Design class in `packages/cli/src/design.js` treats entities as data — it accesses properties and passes them to functions. Entity classes expose the same properties, so the migration is incremental.

### DBML Generation Without Re-parsing

Today: `entity.file → read DDL → cleanupDDLForDBML() → @dbml/core.importer → DBML`

With entity classes: `tableEntity.toDBML() → DBML string`

The `TableEntity` already holds columns, constraints, and FK relationships — it can generate DBML directly without involving `@dbml/core`'s SQL parser. This eliminates:

- The `@dbml/core` dependency for SQL→DBML conversion (keep only for DBML formatting if needed)
- The index-stripping cleanup step (indexes are separate data, not in the DDL being parsed)
- Schema qualification fixups (entities already know their schema)

## Package Location

Entity classes live in `packages/db/`:

```
packages/db/src/
  ├── entities/
  │   ├── parsed-entity.js       # Base class
  │   ├── table-entity.js        # TableEntity
  │   ├── view-entity.js         # ViewEntity
  │   ├── function-entity.js     # FunctionEntity
  │   ├── procedure-entity.js    # ProcedureEntity
  │   ├── trigger-entity.js      # TriggerEntity
  │   ├── role-entity.js         # RoleEntity
  │   ├── schema-entity.js       # SchemaEntity
  │   ├── extension-entity.js    # ExtensionEntity
  │   └── index.js               # re-exports + EntityFactory
  ├── entity-processor.js        # existing (gradually replaced by entity methods)
  ├── dependency-resolver.js     # existing (unchanged — works on refers[])
  └── ...
```

**Why `packages/db`?** Entity classes are database-agnostic value objects. They don't need CLI or adapter dependencies. The CLI creates them, adapters execute their SQL output.

## Serialization Format (for Snapshots)

Each entity serializes to a JSON structure that captures its full state:

```json
{
  "type": "table",
  "name": "config.profiles",
  "schema": "config",
  "columns": [
    {
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultValue": "uuid_generate_v4()",
      "isPrimaryKey": true
    },
    {
      "name": "display_name",
      "type": "varchar(255)",
      "nullable": true,
      "defaultValue": null,
      "isPrimaryKey": false
    }
  ],
  "constraints": [
    {
      "name": "profiles_pkey",
      "type": "primary_key",
      "columns": ["id"]
    },
    {
      "name": "profiles_user_id_fkey",
      "type": "foreign_key",
      "columns": ["user_id"],
      "referencedTable": "auth.users",
      "referencedColumns": ["id"],
      "onDelete": "cascade",
      "onUpdate": null
    }
  ],
  "indexes": [],
  "refers": ["auth.users"],
  "file": "ddl/table/config/profiles.ddl"
}
```

Functions, procedures, triggers store their raw body/definition as a string — these aren't structurally diffable but the string comparison detects changes.

## Diff Output Format

Each entity type produces a typed diff when compared:

```javascript
// TableDiff
{
  type: 'table',
  name: 'config.profiles',
  changes: {
    addedColumns: [{ name: 'avatar_url', type: 'text', ... }],
    droppedColumns: ['legacy_field'],
    alteredColumns: [
      { name: 'display_name', from: { type: 'varchar(100)' }, to: { type: 'varchar(255)' } }
    ],
    addedConstraints: [...],
    droppedConstraints: [...],
    addedIndexes: [...],
    droppedIndexes: [...]
  }
}

// ViewDiff / FunctionDiff / ProcedureDiff
{
  type: 'view',
  name: 'reporting.user_stats',
  changes: {
    definitionChanged: true   // → CREATE OR REPLACE
  }
}

// TriggerDiff
{
  type: 'trigger',
  name: 'audit_trigger',
  changes: {
    changed: true             // → DROP + CREATE (no ALTER TRIGGER)
  }
}
```

## Implementation Sequence

1. **Base class + factory** — `ParsedEntity`, `EntityFactory.fromConfig()` for schema/extension/role
2. **TableEntity** — richest type, proves the pattern, enables DBML improvement
3. **ViewEntity** — simpler, validates the approach for definition-based entities
4. **FunctionEntity / ProcedureEntity** — body-as-string pattern
5. **TriggerEntity** — now parseable with `pgsql-parser`
6. **Wire into Design class** — replace plain objects with entity instances
7. **Add `toDBML()`** — reduce/eliminate `@dbml/core` dependency for SQL parsing
8. **Add `diff()`** — enables Objective 2 (snapshots) and Objective 3 (migrations)

Each step is independently testable and committable.
