# Design: `dbd graph` Command

**Date:** 2026-03-15
**Status:** Approved

## Problem

dbd builds a dependency graph during `apply` but never exposes it. LLM tools working on a schema project have no way to answer questions like "what depends on config.users?" or "what is the safe apply order?" without re-parsing all DDL files themselves.

## Solution

Add a `dbd graph` command that outputs the dependency graph as JSON to stdout. No DB connection required — purely static analysis from DDL files and `design.yaml`.

## Command Interface

```sh
dbd graph                      # Full graph of all DDL entities
dbd graph -n config.users      # Subgraph: named entity + transitive deps + transitive dependants
```

Global options (`--config`, `--database`) still accepted but `--database` is not used.

## Output Shape

```json
{
  "nodes": [
    { "name": "config.users", "type": "table", "schema": "config" },
    { "name": "config.user_roles", "type": "table", "schema": "config" },
    { "name": "config.roles", "type": "table", "schema": "config" }
  ],
  "edges": [
    { "from": "config.user_roles", "to": "config.users" },
    { "from": "config.user_roles", "to": "config.roles" }
  ],
  "layers": [["config.roles", "config.users"], ["config.user_roles"]]
}
```

- `edges[].from` **depends on** `edges[].to`
- `layers[0]` = entities with no dependencies; `layers[N]` depends only on entities in `layers[0..N-1]`
- Layers are in safe-apply order

For `--name` subgraph:

- `nodes` = the named entity + all transitive forward dependencies + all transitive reverse dependants
- `edges` = only edges where both endpoints are in the node set
- `layers` = recalculated over the subgraph nodes only

## Architecture

Three changes, each small and independently testable:

### 1. `packages/db/src/dependency-resolver.js`

Add exported pure function `graphFromEntities(entities, name?)`:

- Builds `Map<name, Set<deps>>` (forward graph) using existing `buildDependencyGraph`
- Builds reverse graph (invert edges) inline
- If `name` given: walk forward graph transitively + walk reverse graph transitively → collect node set → filter edges + recalculate layers
- Returns `{ nodes, edges, layers }` — nodes are `{name, type, schema}` objects

No new dependencies. Uses existing `buildDependencyGraph` and `groupByDependencyLevel`.

### 2. `packages/cli/src/design.js`

Add `graph(name?)` method to `Design` class:

```js
graph(name) {
  return graphFromEntities(this.config.entities, name)
}
```

Uses `this.config.entities` (DDL entities only: tables, views, functions, procedures).
Does not include schemas/extensions/roles — those have no file-based deps to expose.

### 3. `packages/cli/src/index.js`

Register `graph` command:

```js
prog
  .command('graph')
  .option('-n, --name', 'Entity name to scope the graph to')
  .describe('Output the dependency graph as JSON')
  .example('dbd graph')
  .example('dbd graph -n config.users')
  .action(async (opts) => {
    const design = await using(opts.config, opts.database)
    const result = design.graph(opts.name)
    console.log(JSON.stringify(result, null, 2))
  })
```

## Data Flow

```
design.yaml + ddl/ files
  → using() → Design (config.entities populated, refers[] resolved)
  → design.graph(name?)
  → graphFromEntities(entities, name?)
      → buildDependencyGraph (forward edges)
      → build reverse index (invert edges)
      → if name: BFS/DFS forward + reverse to collect node set
      → groupByDependencyLevel (layers, filtered if name given)
      → { nodes, edges, layers }
  → JSON.stringify → stdout
```

## Error Handling

- Unknown `--name`: `graphFromEntities` returns `{ nodes: [], edges: [], layers: [] }` (empty, not an error)
- No entities: same empty result
- No DB connection needed — no connection errors possible

## Testing

- Unit tests in `packages/db/spec/dependency-resolver.spec.js` for `graphFromEntities`:
  - Full graph: correct nodes, edges, layers from fixture entities
  - Subgraph by name: correct transitive forward + reverse collection
  - Unknown name: returns empty result
  - Cyclic entities: included in nodes/edges, appear in their layer
- CLI integration: `design.graph()` returns the right shape

## Files Changed

| File                                           | Change                        |
| ---------------------------------------------- | ----------------------------- |
| `packages/db/src/dependency-resolver.js`       | Add `graphFromEntities()`     |
| `packages/db/src/index.js`                     | Export `graphFromEntities`    |
| `packages/db/spec/dependency-resolver.spec.js` | Tests for `graphFromEntities` |
| `packages/cli/src/design.js`                   | Add `graph(name?)` method     |
| `packages/cli/spec/design.spec.js`             | Tests for `graph()` method    |
| `packages/cli/src/index.js`                    | Register `graph` command      |
| `docs/llms/06-dependency-graph.md`             | Update planned → implemented  |
