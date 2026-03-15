# `dbd graph` Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `dbd graph` command that outputs the entity dependency graph as JSON to stdout, with an optional `--name` flag to scope the output to a subgraph.

**Architecture:** Add `graphFromEntities()` as a pure function in `dependency-resolver.js`, expose it via `Design.graph()`, and register the CLI command. All three changes are independent and testable in isolation.

**Tech Stack:** Node.js ES modules, Vitest, sade (CLI), `@jerrythomas/dbd-db` (existing dependency graph utilities)

**Spec:** `docs/superpowers/specs/2026-03-15-dbd-graph-command-design.md`

---

## Chunk 1: `graphFromEntities()` pure function

### Task 1: `graphFromEntities` — full graph

**Files:**
- Modify: `solution/packages/db/src/dependency-resolver.js`
- Modify: `solution/packages/db/src/index.js`
- Test: `solution/packages/db/spec/dependency-resolver.spec.js`

---

- [ ] **Step 1: Write the failing test**

Add to the bottom of the `describe('dependency-resolver', ...)` block in
`solution/packages/db/spec/dependency-resolver.spec.js`:

```js
describe('graphFromEntities()', () => {
  const entities = [
    { name: 'config.users',      type: 'table', schema: 'config', refers: [] },
    { name: 'config.roles',      type: 'table', schema: 'config', refers: [] },
    { name: 'config.user_roles', type: 'table', schema: 'config', refers: ['config.users', 'config.roles'] }
  ]

  it('returns nodes with name, type, schema only', () => {
    const { nodes } = graphFromEntities(entities)
    expect(nodes).toHaveLength(3)
    expect(nodes[0]).toEqual({ name: 'config.users', type: 'table', schema: 'config' })
    expect(Object.keys(nodes[0])).toEqual(['name', 'type', 'schema'])
  })

  it('returns edges from refers relationships', () => {
    const { edges } = graphFromEntities(entities)
    expect(edges).toHaveLength(2)
    expect(edges).toContainEqual({ from: 'config.user_roles', to: 'config.users' })
    expect(edges).toContainEqual({ from: 'config.user_roles', to: 'config.roles' })
  })

  it('returns layers in dependency order', () => {
    const { layers } = graphFromEntities(entities)
    expect(layers).toHaveLength(2)
    expect(layers[0]).toContain('config.users')
    expect(layers[0]).toContain('config.roles')
    expect(layers[1]).toContain('config.user_roles')
  })

  it('layers contain only names (strings)', () => {
    const { layers } = graphFromEntities(entities)
    layers.forEach(layer => layer.forEach(item => expect(typeof item).toBe('string')))
  })

  it('returns empty result for empty input', () => {
    const result = graphFromEntities([])
    expect(result).toEqual({ nodes: [], edges: [], layers: [] })
  })
})
```

Add `graphFromEntities` to the import at the top of the spec file.

- [ ] **Step 2: Run test to confirm it fails**

```sh
cd solution
bun run test:db 2>&1 | grep -A5 'graphFromEntities'
```

Expected: test fails with `graphFromEntities is not a function` or similar.

- [ ] **Step 3: Implement `graphFromEntities` (full graph)**

Add to the bottom of `solution/packages/db/src/dependency-resolver.js`:

```js
/**
 * Build a JSON-serialisable dependency graph from entities.
 *
 * @param {Array} entities — each must have name, type, schema, refers
 * @param {string} [name] — if given, return a subgraph centred on this entity
 * @returns {{ nodes: Array, edges: Array, layers: string[][] }}
 */
export function graphFromEntities(entities, name) {
  if (!entities || entities.length === 0) return { nodes: [], edges: [], layers: [] }

  const subset = name ? subgraphEntities(entities, name) : entities

  const nodes = subset.map(({ name, type, schema }) => ({ name, type, schema }))
  const nodeNames = new Set(nodes.map((n) => n.name))

  const edges = subset.flatMap((entity) =>
    (entity.refers ?? [])
      .filter((dep) => nodeNames.has(dep))
      .map((dep) => ({ from: entity.name, to: dep }))
  )

  const layers = groupByDependencyLevel(subset).map((layer) => layer.map((e) => e.name))

  return { nodes, edges, layers }
}
```

- [ ] **Step 4: Run the failing tests — they should now pass**

```sh
cd solution
bun run test:db 2>&1 | grep -E '(graphFromEntities|PASS|FAIL)'
```

Expected: all `graphFromEntities` full-graph tests pass.

---

### Task 2: `graphFromEntities` — subgraph by name

Still in `solution/packages/db/spec/dependency-resolver.spec.js` and
`solution/packages/db/src/dependency-resolver.js`.

---

- [ ] **Step 1: Write the failing subgraph tests**

Inside the same `describe('graphFromEntities()', ...)` block, add:

```js
describe('with --name filter', () => {
  const entities = [
    { name: 'a', type: 'table', schema: 's', refers: [] },
    { name: 'b', type: 'table', schema: 's', refers: ['a'] },
    { name: 'c', type: 'table', schema: 's', refers: ['b'] },
    { name: 'd', type: 'table', schema: 's', refers: [] }   // unrelated
  ]

  it('includes the named entity', () => {
    const { nodes } = graphFromEntities(entities, 'b')
    expect(nodes.map(n => n.name)).toContain('b')
  })

  it('includes transitive forward deps', () => {
    const { nodes } = graphFromEntities(entities, 'c')
    const names = nodes.map(n => n.name)
    expect(names).toContain('c')
    expect(names).toContain('b')
    expect(names).toContain('a')
  })

  it('includes transitive reverse dependants', () => {
    const { nodes } = graphFromEntities(entities, 'b')
    const names = nodes.map(n => n.name)
    expect(names).toContain('b')
    expect(names).toContain('c')  // c depends on b
    expect(names).toContain('a')  // b depends on a
  })

  it('excludes unrelated entities', () => {
    const { nodes } = graphFromEntities(entities, 'b')
    expect(nodes.map(n => n.name)).not.toContain('d')
  })

  it('edges only reference nodes in the subgraph', () => {
    const { nodes, edges } = graphFromEntities(entities, 'b')
    const names = new Set(nodes.map(n => n.name))
    edges.forEach(e => {
      expect(names.has(e.from)).toBe(true)
      expect(names.has(e.to)).toBe(true)
    })
  })

  it('returns empty result for unknown name', () => {
    const result = graphFromEntities(entities, 'unknown')
    expect(result).toEqual({ nodes: [], edges: [], layers: [] })
  })
})
```

- [ ] **Step 2: Run to confirm new tests fail**

```sh
cd solution
bun run test:db 2>&1 | grep -E '(subgraph|unknown name|FAIL)'
```

Expected: subgraph tests fail because `subgraphEntities` doesn't exist yet.

- [ ] **Step 3: Implement `subgraphEntities` helper**

Add to `solution/packages/db/src/dependency-resolver.js` before `graphFromEntities`:

```js
/**
 * Collect the subset of entities reachable from `name` in both directions.
 * Forward: transitive deps of `name`. Reverse: transitive dependants of `name`.
 */
function subgraphEntities(entities, name) {
  const byName = new Map(entities.map((e) => [e.name, e]))
  if (!byName.has(name)) return []

  // Build reverse graph: dep -> Set of entities that depend on dep
  const reverse = new Map()
  for (const entity of entities) {
    if (!reverse.has(entity.name)) reverse.set(entity.name, new Set())
    for (const dep of entity.refers ?? []) {
      if (!reverse.has(dep)) reverse.set(dep, new Set())
      reverse.get(dep).add(entity.name)
    }
  }

  // BFS in both directions from `name`
  const visited = new Set()
  const queue = [name]
  while (queue.length > 0) {
    const current = queue.shift()
    if (visited.has(current)) continue
    visited.add(current)
    const entity = byName.get(current)
    if (entity) {
      for (const dep of entity.refers ?? []) queue.push(dep)
    }
    for (const dependant of reverse.get(current) ?? []) queue.push(dependant)
  }

  return entities.filter((e) => visited.has(e.name))
}
```

- [ ] **Step 4: Run all `graphFromEntities` tests**

```sh
cd solution
bun run test:db 2>&1 | grep -E '(graphFromEntities|✓|✗|PASS|FAIL)'
```

Expected: all `graphFromEntities` tests pass, no regressions.

- [ ] **Step 5: Export `graphFromEntities` from the package index**

In `solution/packages/db/src/index.js`, add `graphFromEntities` to the dependency-resolver export:

```js
export {
  buildDependencyGraph,
  findCycles,
  validateDependencies,
  sortByDependencies,
  groupByDependencyLevel,
  graphFromEntities
} from './dependency-resolver.js'
```

- [ ] **Step 6: Verify full db test suite still passes**

```sh
cd solution
bun run test:db
```

Expected: all db tests pass (104 + new tests).

- [ ] **Step 7: Commit**

```sh
cd solution
git add packages/db/src/dependency-resolver.js packages/db/src/index.js packages/db/spec/dependency-resolver.spec.js
git commit -m "feat(db): add graphFromEntities() to dependency-resolver"
```

---

## Chunk 2: `Design.graph()` method + `dbd graph` command

### Task 3: `Design.graph()` method

**Files:**
- Modify: `solution/packages/cli/src/design.js`
- Test: `solution/packages/cli/spec/design.spec.js`

---

- [ ] **Step 1: Write the failing test**

In `solution/packages/cli/spec/design.spec.js`, add a new `describe` block after the existing tests (tests use `process.chdir(exampleDir)` — this is already set up in `beforeEach`):

```js
describe('graph()', () => {
  it('returns nodes, edges, layers', async () => {
    const dx = await using('design.yaml')
    const result = dx.graph()
    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('edges')
    expect(result).toHaveProperty('layers')
  })

  it('nodes have name, type, schema only', async () => {
    const dx = await using('design.yaml')
    const { nodes } = dx.graph()
    expect(nodes.length).toBeGreaterThan(0)
    nodes.forEach(node => {
      expect(Object.keys(node).sort()).toEqual(['name', 'schema', 'type'])
    })
  })

  it('edges reference names that exist in nodes', async () => {
    const dx = await using('design.yaml')
    const { nodes, edges } = dx.graph()
    const nodeNames = new Set(nodes.map(n => n.name))
    edges.forEach(e => {
      expect(nodeNames.has(e.from)).toBe(true)
      expect(nodeNames.has(e.to)).toBe(true)
    })
  })

  it('layers are arrays of strings', async () => {
    const dx = await using('design.yaml')
    const { layers } = dx.graph()
    expect(Array.isArray(layers)).toBe(true)
    layers.forEach(layer => {
      expect(Array.isArray(layer)).toBe(true)
      layer.forEach(item => expect(typeof item).toBe('string'))
    })
  })

  it('graph(name) returns a subgraph for a known entity', async () => {
    const dx = await using('design.yaml')
    const { nodes } = dx.graph()
    if (nodes.length === 0) return // skip if example has no entities
    const firstName = nodes[0].name
    const sub = dx.graph(firstName)
    expect(sub.nodes.map(n => n.name)).toContain(firstName)
  })

  it('graph(unknown) returns empty result', async () => {
    const dx = await using('design.yaml')
    const result = dx.graph('no.such.entity')
    expect(result).toEqual({ nodes: [], edges: [], layers: [] })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```sh
cd solution
bun run test:cli 2>&1 | grep -E '(graph\(\)|FAIL|is not a function)'
```

Expected: `dx.graph is not a function`.

- [ ] **Step 3: Add `graph()` method to `Design` class**

In `solution/packages/cli/src/design.js`:

Add `graphFromEntities` to the import from `@jerrythomas/dbd-db`:

```js
import {
  entityFromSchemaName,
  entityFromExportConfig,
  entityFromExtensionConfig,
  ddlFromEntity,
  validateEntity,
  importScriptForEntity,
  exportScriptForEntity,
  filterEntitiesForDBML,
  sortByDependencies,
  graphFromEntities
} from '@jerrythomas/dbd-db'
```

Add the `graph` method to the `Design` class after the `dbml()` method:

```js
graph(name) {
  return graphFromEntities(this.config.entities, name)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```sh
cd solution
bun run test:cli
```

Expected: all CLI tests pass including the new `graph()` tests.

- [ ] **Step 5: Commit**

```sh
cd solution
git add packages/cli/src/design.js packages/cli/spec/design.spec.js
git commit -m "feat(cli): add Design.graph() method"
```

---

### Task 4: `dbd graph` CLI command

**Files:**
- Modify: `solution/packages/cli/src/index.js`

No new test file needed — the command is a thin wrapper around `Design.graph()` which is already tested. One smoke test confirms the wiring.

---

- [ ] **Step 1: Register the `graph` command**

In `solution/packages/cli/src/index.js`, add after the `dbml` command (before `prog.parse`):

```js
prog
  .command('graph')
  .option('-n, --name', 'Entity name to scope the subgraph to')
  .describe('Output the dependency graph as JSON.')
  .example('dbd graph')
  .example('dbd graph -n config.users')
  .action(async (opts) => {
    const design = await using(opts.config, opts.database)
    const result = design.graph(opts.name)
    console.log(JSON.stringify(result, null, 2))
  })
```

- [ ] **Step 2: Run full test suite**

```sh
cd solution
bun run test
```

Expected: all tests pass, no regressions.

- [ ] **Step 3: Smoke test the command**

```sh
cd solution/example    # or any directory with a design.yaml
node ../packages/cli/src/index.js graph --config design.yaml 2>/dev/null | head -20
```

Expected: JSON output beginning with `{`, containing `nodes`, `edges`, `layers`.

- [ ] **Step 4: Commit**

```sh
cd solution
git add packages/cli/src/index.js
git commit -m "feat(cli): add dbd graph command"
```

---

## Chunk 3: Documentation update

### Task 5: Update `06-dependency-graph.md`

**Files:**
- Modify: `docs/llms/06-dependency-graph.md`

---

- [ ] **Step 1: Change "Planned" to "Available"**

In `docs/llms/06-dependency-graph.md`, change the section heading from:

```markdown
## Planned: `dbd graph` command
```

to:

```markdown
## `dbd graph` command
```

And update the opening sentence from:

```markdown
A future `dbd graph` command would output...
```

to:

```markdown
`dbd graph` outputs the dependency graph as JSON to stdout.
```

Remove the "Proposed JSON output shape:" label — it's now the actual shape.

- [ ] **Step 2: Add usage examples with real output shape**

Replace the "Proposed JSON output shape:" block with:

```markdown
**Full graph:**
```sh
dbd graph
dbd graph -c design.yaml
```

**Subgraph scoped to one entity (forward deps + reverse dependants, transitive):**
```sh
dbd graph -n config.users
```

**Pipe into jq:**
```sh
dbd graph | jq '.nodes[] | select(.type == "table") | .name'
dbd graph | jq '.layers'
dbd graph -n config.users | jq '.edges'
```
```

- [ ] **Step 3: Run lint**

```sh
cd solution
bun run lint
```

Expected: 0 errors.

- [ ] **Step 4: Final full test run**

```sh
cd solution
bun run test
```

Expected: all tests pass.

- [ ] **Step 5: Commit docs update**

```sh
git add docs/llms/06-dependency-graph.md
git commit -m "docs: update dependency-graph doc — dbd graph is now implemented"
```
