# Dependency Graph

## What it is

dbd builds a dependency graph over all DDL entities (tables, views, functions, procedures, roles).
The graph is an adjacency list: each entity has a `refers` array listing the names of entities it
depends on. The graph is used to determine the safe apply order and to identify related entities.

## How the graph is built

### Step 1 — Parse DDL files

Each `.ddl` file is parsed by the PostgreSQL adapter (`parseEntityScript`). The parser extracts
raw references from the AST:

```
REFERENCES clause      → foreign key targets (tables)
FROM / JOIN            → table/view targets
Function calls         → function/procedure targets
SET SEARCH_PATH        → schema search path (context for unqualified names)
```

Each raw reference becomes a `{name, type}` object in `entity.references`.

### Step 2 — Classify references

`matchReferences()` resolves raw references against the entity lookup tree:

1. **Internal classifier** — checks if the name is a built-in PostgreSQL function or matches a
   known installed extension. Internal names are excluded from `refers`.
2. **Lookup** — qualified names (`schema.name`) are matched directly. Unqualified names are
   resolved against `entity.searchPaths`.
3. **Warnings** — references that cannot be resolved become warnings, not errors. They are excluded
   from `refers` but recorded so `inspect` can surface them.

The resolved `refers` array contains only names of entities that are managed by dbd (tables, views,
functions, procedures, roles).

### Step 3 — Roles from design.yaml

Role dependencies are declared explicitly in `design.yaml`:

```yaml
roles:
  - name: advanced
    refers:
      - basic
```

No DDL parsing needed — the `refers` field is taken directly from config.

### Step 4 — Topological sort

`sortByDependencies(entities)` produces a flat list in safe-apply order.
`groupByDependencyLevel(entities)` groups entities into dependency layers:

```
Layer 0: entities with no depends-on (base tables, leaf roles)
Layer 1: entities that only depend on Layer 0
Layer N: entities that depend on any entity in Layers 0..N-1
```

## Entity data model

Every resolved entity has at minimum:

```js
{
  name: "config.lookup_values",    // schema.name (or just name for roles)
  type: "table",                   // table | view | function | procedure | role | schema | extension
  schema: "config",
  file: "ddl/table/config/lookup_values.ddl",
  refers: ["config.lookups"],      // resolved dependency names
  references: [                    // raw parsed references (pre-resolution)
    { name: "lookups", type: "table" },
    { name: "uuid_generate_v4", type: "function" }
  ],
  searchPaths: ["config", "extensions"],
  warnings: [],
  errors: []
}
```

`refers` drives the graph. `references` is the raw parse output before resolution.

## Apply order

`dbd apply` executes entities in this fixed sequence:

```
1. Schemas        (CREATE SCHEMA IF NOT EXISTS — no dependencies)
2. Extensions     (CREATE EXTENSION IF NOT EXISTS — no dependencies)
3. Roles          (topologically sorted by refers)
4. DDL entities   (tables, views, functions, procedures — topologically sorted by refers)
```

Within each group, entities with no dependencies come first.
Entities with cyclic dependencies get `errors: ["Cyclic dependency found"]` and are flagged.

**Reverse order** (used for teardown/migration planning):
`[...sortByDependencies(entities)].reverse()` — entities that nothing depends on come first,
base/foundational entities last.

## Dependency graph API

All functions are in `packages/db/src/dependency-resolver.js`, exported from `@jerrythomas/dbd-db`.

### `buildDependencyGraph(entities)`

Returns a `Map<string, Set<string>>` — entity name → set of its dependency names.

```js
import { buildDependencyGraph } from "@jerrythomas/dbd-db";

const graph = buildDependencyGraph(design.entities);
// graph.get("config.lookup_values") → Set { "config.lookups" }
```

Use for:

- Forward lookup: what does entity X depend on? → `graph.get(x)`
- Building a reverse index (what depends on X): iterate all entries, invert the edges

### `sortByDependencies(entities)`

Returns entities sorted in safe-apply order (topological sort).
Cyclic entities are included but have `errors: ["Cyclic dependency found"]`.

```js
import { sortByDependencies } from "@jerrythomas/dbd-db";

const ordered = sortByDependencies(entities);
// Guaranteed: for every entity, all its `refers` appear before it in the list
```

### `groupByDependencyLevel(entities)`

Returns `Array[]` — each inner array is one dependency layer.

```js
import { groupByDependencyLevel } from "@jerrythomas/dbd-db";

const layers = groupByDependencyLevel(entities);
// layers[0] — no dependencies (leaf tables)
// layers[1] — depends only on layers[0]
// layers[N] — depends on layers[0..N-1]
```

Useful for: parallelising apply, visualising the graph depth, understanding which entities
are foundational vs derived.

### `findCycles(graph)`

Returns `string[][]` — one array per detected cycle group.

```js
import { buildDependencyGraph, findCycles } from "@jerrythomas/dbd-db";

const graph = buildDependencyGraph(entities);
const cycles = findCycles(graph);
// cycles = [] — no cycles
// cycles = [["a", "b"]] — a depends on b and b depends on a
```

### `validateDependencies(entities)`

Returns `{ isValid: boolean, cycles: string[][], warnings: string[] }`.
Warnings list missing dependencies (referenced names not in the entity set).

```js
import { validateDependencies } from "@jerrythomas/dbd-db";

const { isValid, cycles, warnings } = validateDependencies(entities);
```

## Computing the reverse graph (what depends on X)

The API provides forward edges. Compute reverse edges yourself:

```js
function buildReverseGraph(entities) {
  const reverse = new Map();
  for (const entity of entities) {
    if (!reverse.has(entity.name)) reverse.set(entity.name, new Set());
    for (const dep of entity.refers ?? []) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(entity.name);
    }
  }
  return reverse;
}

// Usage:
const reverse = buildReverseGraph(design.entities);
reverse.get("config.lookups");
// → Set { "config.lookup_values", "config.active_lookups_view" }
// "What entities reference config.lookups?"
```

## Using the graph for LLM tasks

The dependency graph acts as a call graph for the schema. Common LLM-assisted tasks:

### Finding all dependencies of a table (transitive)

```js
function transitiveDeps(name, graph, visited = new Set()) {
  if (visited.has(name)) return visited;
  visited.add(name);
  for (const dep of graph.get(name) ?? []) {
    transitiveDeps(dep, graph, visited);
  }
  visited.delete(name); // exclude the entity itself
  return visited;
}

const graph = buildDependencyGraph(design.entities);
transitiveDeps("config.user_roles", graph);
// → Set { "config.users", "config.roles" }
```

### Finding all dependants (transitive reverse)

```js
const reverse = buildReverseGraph(design.entities);
transitiveDeps("config.users", reverse);
// → Set { "config.user_roles", "config.audit_log", "views using users..." }
```

### Scoping a change

When modifying entity X, the entities at risk are:

- X's transitive dependants (reverse graph, all layers above X)

When adding entity X, the entities X needs to exist first are:

- X's transitive dependencies (forward graph)

### Impact analysis for `dbd apply -n <name>`

```
apply -n config.lookup_values
  requires: config.lookups (must already exist)
  safe to run: only config.lookup_values is touched
```

```
apply                              (all entities)
  apply order: see groupByDependencyLevel output
  if an entity fails: its dependants are not applied (errors propagate via adapter.applyEntities)
```

## Inspecting the graph at runtime

Access the graph through the `Design` instance after `using()`:

```js
import { using } from "@jerrythomas/dbd-cli";
import {
  buildDependencyGraph,
  groupByDependencyLevel,
} from "@jerrythomas/dbd-db";

const design = await using("design.yaml", process.env.DATABASE_URL);

// All resolved entities (schemas + extensions + roles + DDL entities)
const allEntities = design.entities;

// Only DDL entities (tables, views, functions, procedures)
const ddlEntities = design.config.entities;

// Dependency layers for DDL entities
const layers = groupByDependencyLevel(ddlEntities);
layers.forEach((layer, i) => {
  console.log(
    `Layer ${i}:`,
    layer.map((e) => `${e.type}:${e.name}`),
  );
});

// Forward graph
const graph = buildDependencyGraph(ddlEntities);

// For a specific entity
const deps = graph.get("config.lookup_values"); // → Set { "config.lookups" }
```

## `dbd graph` command

Outputs the dependency graph as JSON to stdout. No database connection required.

```sh
dbd graph                       # Full graph of all DDL entities
dbd graph -n config.users       # Subgraph: entity + transitive deps + transitive dependants
```

**Pipe into jq:**

```sh
dbd graph | jq '.nodes[] | select(.type == "table") | .name'
dbd graph | jq '.layers'
dbd graph -n config.users | jq '.edges'
```

**JSON output shape:**

```json
{
  "nodes": [
    { "name": "config.users", "type": "table", "schema": "config" },
    { "name": "config.user_roles", "type": "table", "schema": "config" }
  ],
  "edges": [{ "from": "config.user_roles", "to": "config.users" }],
  "layers": [["config.users"], ["config.user_roles"]]
}
```

- `edges[].from` depends on `edges[].to`
- `layers[0]` = entities with no dependencies; safe-apply order ascending

This output can be fed to an LLM to answer questions like:

- "What tables reference config.users?"
- "What is the safe drop order for the config schema?"
- "Which entities are affected if I change config.lookups?"
