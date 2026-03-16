# Complexity Reduction — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all functions with cyclomatic complexity > 10 below 10 by extracting named helper functions within each file.

**Architecture:** Pure within-file refactoring — extract named helpers from complex arrow callbacks, long if/else chains, and nested loop bodies. No new files, no public API changes, no behaviour changes. Existing tests are the safety net.

**Tech Stack:** Node.js ES Modules, Vitest, Bun

---

## Chunk 1: Translators

**Test command for this chunk:** `bun run test:postgres`

### Task 1: `translators/types.js` — `resolveDefaultExpr` (complexity 15 → ~5)

**File:** `packages/postgres/src/parser/translators/types.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:
  ```js
  const resolveAConstDefault = (ac) => {
    if (ac.ival !== undefined && typeof ac.ival === 'object') return ac.ival.ival ?? 0
    if (ac.sval?.sval !== undefined) return ac.sval.sval
    if (ac.fval?.fval !== undefined) return ac.fval.fval
    if (ac.boolval !== undefined && typeof ac.boolval === 'object')
      return ac.boolval.boolval ?? false
    // undefined = no A_Const subtype recognised — caller falls through
  }
  ```
- [ ] Replace the complex section in the original function with calls to the helper(s):

  ```js
  export const resolveDefaultExpr = (rawExpr) => {
    if (rawExpr.A_Const) {
      const val = resolveAConstDefault(rawExpr.A_Const)
      if (val !== undefined) return val
    }

    if (rawExpr.FuncCall) {
      const funcName = rawExpr.FuncCall.funcname
        ?.map((n) => n.String?.sval)
        .filter(Boolean)
        .join('.')
      return `${funcName}()`
    }

    if (rawExpr.TypeCast) {
      return resolveDefaultExpr(rawExpr.TypeCast.arg)
    }

    return '[EXPRESSION]'
  }
  ```

- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 2: `translators/where-expr.js` — `translateWhereExpr` (complexity 15 → ~7)

**File:** `packages/postgres/src/parser/translators/where-expr.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:
  ```js
  const translateAConst = (ac) => {
    if (ac.sval) return { type: 'string', value: ac.sval.sval }
    if (ac.ival !== undefined) return { type: 'number', value: ac.ival.ival ?? 0 }
    if (ac.boolval !== undefined) return { type: 'bool', value: ac.boolval.boolval ?? false }
    return { type: 'expression' }
  }
  ```
- [ ] Replace the complex section in the original function with calls to the helper(s):
  ```js
  if (expr.A_Const) return translateAConst(expr.A_Const)
  ```
- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 3: `translators/create-view.js` — `translateTargetExpr` (complexity 20 → ~7)

**File:** `packages/postgres/src/parser/translators/create-view.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:
  ```js
  const translateColumnRef = (fields) => {
    if (fields.length === 2) {
      return { type: 'column_ref', table: fields[0].String?.sval, column: fields[1].String?.sval }
    }
    if (fields[0]?.A_Star) return { type: 'star', value: '*' }
    return { type: 'column_ref', table: null, column: fields[0].String?.sval }
  }
  ```
- [ ] Replace the complex section in the original function with calls to the helper(s):
  ```js
  if (val?.ColumnRef) return translateColumnRef(val.ColumnRef.fields)
  ```
- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 4: `translators/create-table.js` — switch (14) and `translateCreateStmt` (25)

**File:** `packages/postgres/src/parser/translators/create-table.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:

  **4a — reduce the switch:** Extract `buildForeignKeyConstraint` before `CONSTR_HANDLERS`, then replace `translateColumnConstraints` with a dispatch-table approach:

  ```js
  const buildForeignKeyConstraint = (con) => ({
    type: 'FOREIGN KEY',
    table: con.pktable.relname,
    schema: con.pktable?.schemaname || null,
    column: con.pk_attrs?.[0]?.String?.sval || 'id'
  })

  const CONSTR_HANDLERS = {
    CONSTR_NOTNULL: (state) => {
      state.nullable = false
    },
    CONSTR_DEFAULT: (state, con) => {
      state.defaultValue = resolveDefaultExpr(con.raw_expr)
    },
    CONSTR_PRIMARY: (state) => {
      state.isPrimaryKey = true
      state.nullable = false
      state.constraints.push({ type: 'PRIMARY KEY' })
    },
    CONSTR_UNIQUE: (state) => {
      state.constraints.push({ type: 'UNIQUE' })
    },
    CONSTR_FOREIGN: (state, con) => {
      state.constraints.push(buildForeignKeyConstraint(con))
    },
    CONSTR_CHECK: (state) => {
      state.constraints.push({ type: 'CHECK' })
    }
  }

  const translateColumnConstraints = (rawConstraints) => {
    const state = { nullable: true, defaultValue: null, isPrimaryKey: false, constraints: [] }
    for (const c of rawConstraints) {
      const handler = CONSTR_HANDLERS[c.Constraint.contype]
      if (handler) handler(state, c.Constraint)
    }
    return state
  }
  ```

  **4b — reduce `translateCreateStmt`:** Extract two helpers before `translateCreateStmt`:

  ```js
  const applyTableForeignKey = (columns, con) => {
    const fkColName = con.fk_attrs[0].String?.sval
    const col = columns.find((c) => c.name === fkColName)
    if (!col) return
    const fk = buildForeignKeyConstraint(con)
    col.constraints.push(fk)
    col.reference_definition = {
      table: [{ table: fk.table, schema: fk.schema }],
      definition: [{ column: { expr: { value: fk.column } } }]
    }
  }

  const applyTablePrimaryKey = (columns, con) => {
    for (const key of con.keys) {
      const colName = key.String?.sval
      const col = columns.find((c) => c.name === colName)
      if (!col) continue
      col.nullable = false
      if (!col.constraints.some((c) => c.type === 'PRIMARY KEY')) {
        col.constraints.push({ type: 'PRIMARY KEY' })
      }
      col.primary_key = 'primary key'
    }
  }
  ```

- [ ] Replace the complex section in the original function with calls to the helper(s):

  ```js
  for (const tc of tableConstraints) {
    const con = tc.Constraint
    if (con?.contype === 'CONSTR_FOREIGN' && con.fk_attrs?.length)
      applyTableForeignKey(columns, con)
    if (con?.contype === 'CONSTR_PRIMARY' && con.keys?.length) applyTablePrimaryKey(columns, con)
  }
  ```

  Note: `buildForeignKeyConstraint` is now shared between `CONSTR_HANDLERS` and `applyTableForeignKey`. The existing `translateTableConstraint` function also has an inline FK object — replace it too:

  ```js
  	case 'CONSTR_FOREIGN':
  		return {
  			...base,
  			type: 'foreign_key',
  			constraint: 'FOREIGN KEY',
  			conname: con.conname,
  			fk_attrs: con.fk_attrs.map((k) => k.String?.sval).filter(Boolean),
  			pktable: {
  				relname: con.pktable?.relname,
  				schemaname: con.pktable?.schemaname
  			},
  			pk_attrs: (con.pk_attrs || []).map((k) => k.String?.sval).filter(Boolean)
  		}
  ```

  (This one is a different shape — table-level constraint, not column — keep it as-is.)

- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)

  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

- [ ] Commit chunk 1
  ```bash
  cd /Users/Jerry/Developer/dbd && git add packages/postgres/src/parser/translators/ && git commit -m "refactor(postgres): reduce complexity in translator helpers"
  ```

---

## Chunk 2: Extractors

**Test command for this chunk:** `bun run test:postgres`

### Task 5: `extractors/tables.js` — `extractComments` (complexity 45 → ~8)

**File:** `packages/postgres/src/parser/extractors/tables.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:

  ```js
  const resolveCommentValue = (expr) => {
    if (expr.expr?.value) return expr.expr.value
    if (typeof expr.value === 'string') return expr.value
    if (typeof expr === 'string') return expr
    return null
  }

  const resolveCommentTarget = (name) => {
    if (typeof name === 'string') {
      const parts = name.split('.')
      return parts.length > 1
        ? { schemaName: parts[0], tableName: parts[1] }
        : { schemaName: null, tableName: parts[0] }
    }
    return { schemaName: name?.schema || name?.db || null, tableName: name?.table }
  }

  const resolveColumnTarget = (name) => {
    if (typeof name === 'string') {
      const parts = name.split('.')
      if (parts.length === 3)
        return { schemaName: parts[0], tableName: parts[1], columnName: parts[2] }
      if (parts.length === 2) return { schemaName: null, tableName: parts[0], columnName: parts[1] }
      return { schemaName: null, tableName: null, columnName: parts[0] }
    }
    const columnName = name?.column?.expr?.value ?? name?.column
    return { schemaName: name?.schema || name?.db || null, tableName: name?.table, columnName }
  }

  const processTableComment = (stmt, comments) => {
    const { schemaName, tableName } = resolveCommentTarget(stmt.target.name)
    const comment = resolveCommentValue(stmt.expr)
    const tableKey = schemaName ? `${schemaName}.${tableName}` : tableName
    if (tableName && comment) comments.tables[tableKey] = comment
  }

  const processColumnComment = (stmt, comments) => {
    const { schemaName, tableName, columnName } = resolveColumnTarget(stmt.target.name)
    const comment = resolveCommentValue(stmt.expr)
    const tableKey = schemaName ? `${schemaName}.${tableName}` : tableName
    if (tableName && columnName && comment) {
      if (!comments.columns[tableKey]) comments.columns[tableKey] = {}
      comments.columns[tableKey][columnName] = comment
    }
  }
  ```

- [ ] Replace the complex section in the original function with calls to the helper(s):

  ```js
  export const extractComments = (ast) => {
    const comments = { tables: {}, columns: {} }
    if (!ast || !Array.isArray(ast)) return comments

    for (const stmt of ast) {
      if (stmt.type !== 'comment' || stmt.keyword !== 'on' || !stmt.target || !stmt.expr) continue
      if (stmt.target.type === 'table') processTableComment(stmt, comments)
      else if (stmt.target.type === 'column') processColumnComment(stmt, comments)
    }

    return comments
  }
  ```

- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 6: `extractors/tables.js` — `extractColumnConstraints` (complexity 22 → ~8)

**File:** `packages/postgres/src/parser/extractors/tables.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:

  ```js
  const extractFKFromRefDef = (ref) => ({
    type: 'FOREIGN KEY',
    table: ref.table[0].table,
    schema: ref.table[0].schema,
    column: ref.definition?.[0]?.column?.expr?.value || ref.definition?.[0]?.column || 'id'
  })

  const extractFKFromConstraintList = (constraints) => {
    for (const constraint of constraints) {
      if (constraint.Constraint?.contype === 'CONSTR_FOREIGN') {
        return {
          type: 'FOREIGN KEY',
          table: constraint.Constraint.pktable.relname,
          schema: constraint.Constraint.pktable.schemaname,
          column: constraint.Constraint.pk_attrs?.[0]?.String?.str || 'id'
        }
      }
    }
    return null
  }
  ```

- [ ] Replace the complex section in the original function with calls to the helper(s):

  ```js
  export const extractColumnConstraints = (columnDef) => {
    const constraints = []

    if (columnDef.primary_key) {
      constraints.push({ type: 'PRIMARY KEY' })
    } else if (columnDef.constraints) {
      for (const constraint of columnDef.constraints) {
        if (
          constraint.Constraint?.contype === 'CONSTR_PRIMARY' ||
          constraint.type === 'primary key'
        ) {
          constraints.push({ type: 'PRIMARY KEY' })
          break
        }
      }
    }

    if (columnDef.reference_definition) {
      constraints.push(extractFKFromRefDef(columnDef.reference_definition))
    } else if (columnDef.constraints) {
      const fk = extractFKFromConstraintList(columnDef.constraints)
      if (fk) constraints.push(fk)
    }

    return constraints
  }
  ```

- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 7: `extractors/views.js` — `extractViewColumns` (complexity 12 → ~5) and `extractViewDependencies` (complexity 14 → ~8)

**File:** `packages/postgres/src/parser/extractors/views.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:

  **7a — `extractViewColumns`:** Extract two helpers before it:

  ```js
  const resolveViewColumnName = (col) => {
    if (col.as) return col.as
    if (col.expr.column) return col.expr.column
    if (col.expr.name) return col.expr.name
    return '[EXPRESSION]'
  }

  const resolveViewColumnSource = (col) => {
    if (col.expr.type === 'column_ref') return { table: col.expr.table, column: col.expr.column }
    if (col.expr.type === 'binary_expr' && col.expr.operator === '->') {
      return {
        type: 'json_extract',
        expression: `${col.expr.left.column} -> ${col.expr.right.value}`
      }
    }
    if (col.expr.type === 'function') {
      return { type: 'function', name: col.expr.name?.name?.[0]?.value || col.expr.name }
    }
    return { type: 'expression' }
  }
  ```

  **7b — `extractViewDependencies`:** Promote the `addDependency` and `collectFromDeps` closures to module-level named functions, taking `dependencies` and `cteNames` as parameters:

  ```js
  const addViewDependency = (table, dependencies, cteNames) => {
    if (!table || typeof table !== 'object') return
    const tableName = table.table || table.name
    if (cteNames.has(tableName)) return
    dependencies.push({
      table: tableName,
      name: tableName,
      schema: table.db || table.schema,
      alias: table.as || null
    })
  }

  const collectFromItems = (from, dependencies, cteNames) => {
    if (!Array.isArray(from)) return
    for (const item of from) {
      if (item.table) addViewDependency(item, dependencies, cteNames)
      else if (item.expr) dependencies.push({ type: 'subquery' })
      if (item.join) addViewDependency(item.join, dependencies, cteNames)
    }
  }
  ```

- [ ] Replace the complex section in the original function with calls to the helper(s):

  Replace `extractViewColumns`:

  ```js
  export const extractViewColumns = (stmt) => {
    const selectStmt = stmt.select
    if (!selectStmt || !selectStmt.columns) return []
    return selectStmt.columns.map((col) => ({
      name: resolveViewColumnName(col),
      source: resolveViewColumnSource(col)
    }))
  }
  ```

  Replace `extractViewDependencies`:

  ```js
  export const extractViewDependencies = (stmt) => {
    if (!stmt.select || !stmt.select.from) return []

    const cteNames = new Set()
    if (stmt.select.with && Array.isArray(stmt.select.with)) {
      for (const cte of stmt.select.with) {
        const name = cte.name?.value || cte.name
        if (name) cteNames.add(name)
      }
    }

    const dependencies = []

    if (stmt.select.with && Array.isArray(stmt.select.with)) {
      for (const cte of stmt.select.with) {
        if (cte.stmt?.from) collectFromItems(cte.stmt.from, dependencies, cteNames)
      }
    }

    collectFromItems(stmt.select.from, dependencies, cteNames)
    return dependencies
  }
  ```

- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 8: `extractors/db-indexes.js` — `extractTableName` (complexity 11 → ~9) and `extractIndexColumns` (complexity 12 → ~5)

**File:** `packages/postgres/src/parser/extractors/db-indexes.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:

  **8b — `extractIndexColumns`:** Extract two helpers before it:

  ```js
  const resolveIndexColumnName = (col) => {
    if (col.column?.column?.expr?.value) return col.column.column.expr.value
    if (col.column?.column) return col.column.column
    if (col.name) return col.name
    if (col.expr?.column) return col.expr.column
    return null
  }

  const resolveIndexColumnOrder = (col) => {
    if (col.order) return col.order.toUpperCase()
    if (col.direction) return col.direction.toUpperCase()
    return 'ASC'
  }
  ```

- [ ] Replace the complex section in the original function with calls to the helper(s):

  **8a — `extractTableName`:** Replace with early-return form that avoids deep `?.` chaining:

  ```js
  export const extractTableName = (stmt) => {
    const table = stmt.table
    if (table && typeof table === 'object') return table.table || null
    if (stmt.table_name && stmt.table_name[0]) return stmt.table_name[0].table || null
    if (stmt.relationName) return stmt.relationName
    if (stmt.on && stmt.on[0]) return stmt.on[0].table || null
    if (typeof table === 'string') return table
    return null
  }
  ```

  **8b — `extractIndexColumns`:** Replace with helper-based form:

  ```js
  export const extractIndexColumns = (stmt) => {
    if (!stmt.columns || !Array.isArray(stmt.columns)) return []
    return stmt.columns
      .map((col) => ({ name: resolveIndexColumnName(col), order: resolveIndexColumnOrder(col) }))
      .filter((col) => col.name)
  }
  ```

- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 9: `extractors/procedures.js` — parameter parsing arrow (complexity 13 → ~5)

**File:** `packages/postgres/src/parser/extractors/procedures.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:
  ```js
  const parseRawParameter = (paramStr) => {
    const paramParts = paramStr.trim().split(/\s+/)
    if (/^IN(OUT)?$/i.test(paramParts[0]) || /^OUT$/i.test(paramParts[0])) {
      return {
        mode: paramParts[0].toLowerCase(),
        name: paramParts[1],
        dataType: paramParts.slice(2).join(' ').toLowerCase()
      }
    }
    return {
      mode: 'in',
      name: paramParts[0],
      dataType: paramParts.slice(1).join(' ').toLowerCase()
    }
  }
  ```
- [ ] Replace the complex section in the original function with calls to the helper(s):
  ```js
  const parameters = params.split(',').filter(Boolean).map(parseRawParameter)
  ```
- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)

  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

- [ ] Commit chunk 2
  ```bash
  cd /Users/Jerry/Developer/dbd && git add packages/postgres/src/parser/extractors/ && git commit -m "refactor(postgres): reduce complexity in extractor helpers"
  ```

---

## Chunk 3: index-functional.js

**Test command for this chunk:** `bun run test:postgres`

### Task 10: `index-functional.js` — `identifyEntity` (complexity 28 → ~5) and `collectReferences` (complexity 22 → ~5)

**File:** `packages/postgres/src/parser/index-functional.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:

  **10a — `identifyEntity`:** Add four per-keyword extractors and a dispatch map before `identifyEntity`:

  ```js
  const extractTableEntity = (stmt) => {
    const info = stmt.table?.[0]
    return info ? { name: info.table, schema: info.db || null } : null
  }

  const extractViewEntity = (stmt) => {
    const info = stmt.view
    return info ? { name: info.view, schema: info.db || null } : null
  }

  const extractProcedureEntity = (stmt) => {
    const info = stmt.procedure
    if (typeof info === 'object' && info !== null) {
      return { name: info.procedure || info.name, schema: info.schema || null }
    }
    return info ? { name: info, schema: null } : null
  }

  const extractFunctionEntity = (stmt) => {
    const info = stmt.name
    return info?.name?.[0] ? { name: info.name[0].value, schema: info.schema || null } : null
  }

  const ENTITY_EXTRACTORS = {
    table: extractTableEntity,
    view: extractViewEntity,
    procedure: extractProcedureEntity,
    function: extractFunctionEntity
  }
  ```

  **10b — `collectReferences`:** Extract four per-type collectors before `collectReferences`:

  ```js
  const collectTableFKRefs = (tables) => {
    const refs = []
    for (const table of tables) {
      for (const col of table.columns || []) {
        for (const constraint of col.constraints || []) {
          if (constraint.type === 'FOREIGN KEY' && constraint.table) {
            const name = constraint.schema
              ? `${constraint.schema}.${constraint.table}`
              : constraint.table
            refs.push({ name, type: 'table' })
          }
        }
      }
    }
    return refs
  }

  const collectViewRefs = (views) => {
    const refs = []
    for (const view of views) {
      for (const dep of view.dependencies || []) {
        if (dep.type === 'subquery' || !dep.table) continue
        const name = dep.schema ? `${dep.schema}.${dep.table}` : dep.table
        refs.push({ name, type: 'table/view' })
      }
    }
    return refs
  }

  const collectProcRefs = (procedures) => {
    const refs = []
    for (const proc of procedures) {
      for (const tableRef of proc.tableReferences || []) {
        refs.push({ name: tableRef, type: 'table/view' })
      }
    }
    return refs
  }

  const collectTriggerRefs = (triggers) => {
    const refs = []
    for (const trigger of triggers) {
      if (trigger.table) {
        const tableName = trigger.tableSchema
          ? `${trigger.tableSchema}.${trigger.table}`
          : trigger.table
        refs.push({ name: tableName, type: 'table' })
      }
      if (trigger.executeFunction) refs.push({ name: trigger.executeFunction, type: 'function' })
    }
    return refs
  }
  ```

- [ ] Replace the complex section in the original function with calls to the helper(s):

  Replace `identifyEntity`:

  ```js
  export const identifyEntity = (ast, sql) => {
    if (!ast || !Array.isArray(ast)) return null

    const createStmt = find(
      (stmt) => stmt.type === 'create' && stmt.keyword in ENTITY_EXTRACTORS,
      ast
    )

    if (createStmt) {
      const info = ENTITY_EXTRACTORS[createStmt.keyword](createStmt)
      return info ? { ...info, type: createStmt.keyword } : null
    }

    if (sql) {
      const match = sql.match(
        /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:(\w+)\.)?(\w+)/i
      )
      if (match) {
        const keyword = /FUNCTION/i.test(match[0]) ? 'function' : 'procedure'
        return { name: match[2], schema: match[1] || null, type: keyword }
      }
    }

    return null
  }
  ```

  Replace `collectReferences`:

  ```js
  export const collectReferences = ({ tables, views, procedures, triggers }) => {
    const allRefs = [
      ...collectTableFKRefs(tables),
      ...collectViewRefs(views),
      ...collectProcRefs(procedures),
      ...collectTriggerRefs(triggers)
    ]

    const seen = new Set()
    return allRefs.filter((ref) => {
      if (seen.has(ref.name)) return false
      seen.add(ref.name)
      return true
    })
  }
  ```

- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)

  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

- [ ] Commit chunk 3
  ```bash
  cd /Users/Jerry/Developer/dbd && git add packages/postgres/src/parser/index-functional.js && git commit -m "refactor(postgres): reduce complexity in index-functional.js"
  ```

---

## Chunk 4: Other packages

**Test command for this chunk:** `bun run test`

### Task 11: `dependency-resolver.js` — `subgraphEntities` (complexity 16 → ~3)

**File:** `packages/db/src/dependency-resolver.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:

  ```js
  function buildReverseGraph(entities) {
    const reverse = {}
    for (const entity of entities) {
      for (const dep of entity.refers || []) {
        if (!reverse[dep]) reverse[dep] = []
        reverse[dep].push(entity.name)
      }
    }
    return reverse
  }

  function bfsVisit(startName, lookup, reverse) {
    const visited = new Set()
    const queue = [startName]
    while (queue.length > 0) {
      const current = queue.shift()
      if (visited.has(current)) continue
      visited.add(current)
      const entity = lookup[current]
      if (entity) {
        for (const dep of entity.refers || []) {
          if (!visited.has(dep) && dep in lookup) queue.push(dep)
        }
      }
      for (const dependent of reverse[current] || []) {
        if (!visited.has(dependent)) queue.push(dependent)
      }
    }
    return visited
  }
  ```

- [ ] Replace the complex section in the original function with calls to the helper(s):
  ```js
  function subgraphEntities(entities, name) {
    const lookup = buildLookup(entities)
    if (!(name in lookup)) return []
    const reverse = buildReverseGraph(entities)
    const visited = bfsVisit(name, lookup, reverse)
    return entities.filter((e) => visited.has(e.name))
  }
  ```
- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 12: `entity-processor.js` — `validateEntity` (complexity 16 → ~9)

**File:** `packages/db/src/entity-processor.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:db
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:

  ```js
  function validateTypedSchema(entity) {
    const errors = []
    if (entity.name.split('.').length !== 2) errors.push('Use fully qualified name <schema>.<name>')
    if (!entity.file) errors.push('File missing for import entity')
    return errors
  }

  function validateEntityReferences(entity, ignore) {
    const errors = []
    if (!entity.references || entity.references.length === 0) return errors
    entity.references
      .filter((ref) => !ignore.includes(ref.name))
      .filter((ref) => ref.error)
      .forEach((ref) => errors.push(ref.error))
    return errors
  }
  ```

- [ ] Replace the complex section in the original function with calls to the helper(s):

  ```js
  export function validateEntity(entity, ddl = true, ignore = []) {
    let errors = []
    ddl = ddl && entity.type !== 'import'

    if (entity.name === null) errors.push('Location of the file is incorrect')

    if (!allowedTypes.includes(entity.type)) {
      errors.push('Unknown or unsupported entity type.')
      if (entity.file) errors.push('Unknown or unsupported entity ddl script.')
    }

    if (typesWithoutSchema.includes(entity.type) && entity.file) {
      errors.push(`"${entity.type}" does not need a ddl file.`)
    }

    if (typesWithSchema.includes(entity.type)) {
      errors = [...errors, ...validateTypedSchema(entity)]
    }

    errors = [...errors, ...validateEntityReferences(entity, ignore)]

    if (entity.file) errors = [...errors, ...validateFiles(entity, ddl)]

    return errors.length > 0 ? { ...entity, errors } : entity
  }
  ```

- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 13: `psql-adapter.js` — `applyEntity` (complexity 11 → ~6)

**File:** `packages/postgres/src/psql-adapter.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:
  ```js
  const buildDryRunMessage = (entity) => {
    const using =
      entity.file || entity.type === 'extension' ? ` using "${entity.file || entity.schema}"` : ''
    return `[dry-run] ${entity.type} => ${entity.name}${using}`
  }
  ```
- [ ] Replace the complex section in the original function with calls to the helper(s):
  ```js
  this.log(buildDryRunMessage(entity))
  ```
- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

### Task 14: `reference-classifier.js` — `isExtension` (complexity 11 → ~4)

**File:** `packages/postgres/src/reference-classifier.js`

- [ ] Verify tests pass before starting
  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test:postgres
  ```
- [ ] Extract helper(s) — add these functions BEFORE the function being fixed:
  ```js
  const extensionMatchesInput = (extension, input) => {
    if (Array.isArray(extension.entities) && extension.entities.includes(input)) return true
    if (Array.isArray(extension.patterns)) {
      return extension.patterns.some((pattern) => new RegExp(pattern).test(input))
    }
    return false
  }
  ```
- [ ] Replace the complex section in the original function with calls to the helper(s):
  ```js
  export function isExtension(input, installed = []) {
    for (const extKey of installed) {
      const extension = extensions[extKey]
      if (extension && extensionMatchesInput(extension, input)) return 'extension'
    }
    return null
  }
  ```
- [ ] Verify tests still pass
- [ ] Run lint check (must stay at 0 errors)

  ```bash
  cd /Users/Jerry/Developer/dbd && bun run lint 2>&1 | grep "error"
  ```

- [ ] Final verification — all tests pass, complexity warnings > 10 are gone:

  ```bash
  cd /Users/Jerry/Developer/dbd && bun run test && npx eslint --config config/eslint.config.js . 2>&1 | awk '/^\//{file=$0} /complexity/{print file, $0}' | grep -v "complexity of [1-9]\." | grep -v "Maximum"
  ```

- [ ] Commit chunk 4
  ```bash
  cd /Users/Jerry/Developer/dbd && git add packages/db/src/dependency-resolver.js packages/db/src/entity-processor.js packages/postgres/src/psql-adapter.js packages/postgres/src/reference-classifier.js && git commit -m "refactor: reduce complexity in db, adapter, and classifier modules"
  ```

---

## Verification

After all chunks:

```bash
cd /Users/Jerry/Developer/dbd
bun run test        # 684 tests must pass
bun run lint        # 0 errors
npx eslint --config config/eslint.config.js . 2>&1 | awk '/^\//{file=$0} /complexity/{print file, $0}' | grep -E "complexity of (1[1-9]|[2-9][0-9])"
# Should print nothing (no complexity > 10 remaining)
```
