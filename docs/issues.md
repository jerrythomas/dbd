# Known Issues

## Bug: Self-referencing composite FK silently overwrites tenant FK dependency detection

**Date found:** 2026-03-18
**Severity:** High — causes edge tables to be applied before their dependency (`core.tenants`), silently skipping them
**Status:** Fixed — `packages/postgres/src/parser/extractors/tables.js` (`extractColumnConstraints`), not yet committed

### Symptom

`dbd apply` reports "Applying table: edge.region_levels" but the table is never created. `dbd inspect` shows `references: []` even when named FK constraints are present.

### Root cause

In `packages/postgres/src/parser/translators/create-table.js`, `applyTableForeignKey` maps each table-level FK constraint to a column by taking `fk_attrs[0]` (the first FK column) and setting `reference_definition` on that column.

When a table has both:

1. A simple FK: `CONSTRAINT x FOREIGN KEY (tenant_id) REFERENCES core.tenants(id)`
2. A composite FK on the same first column: `CONSTRAINT y FOREIGN KEY (tenant_id, parent_id) REFERENCES self_table(tenant_id, id)`

…and the composite FK is declared **after** the simple FK in the DDL, `applyTableForeignKey` overwrites the `tenant_id` column's `reference_definition` with the composite FK's target (`self_table`), erasing the simple FK's target (`core.tenants`).

Since the extractor reads only `reference_definition` to collect FK references, `core.tenants` is lost from the dependency graph. The self-reference creates no useful dependency (it's the same table), so `edge.region_levels` ends up in dependency layer 0 — before `core.tenants` — causing the apply to fail silently.

### Affected DDL pattern

```sql
-- This pattern triggers the bug:
CONSTRAINT a FOREIGN KEY (tenant_id) REFERENCES core.tenants(id),
CONSTRAINT b FOREIGN KEY (tenant_id, parent_id) REFERENCES same_table(tenant_id, id)
-- ^ composite FK on same first column overwrites 'a' above
```

### Workaround (in DDL files)

Reorder constraints so the **composite self-referencing FK comes before** the simple tenant FK:

```sql
-- Workaround: self-ref first, tenant FK last (wins the reference_definition slot)
CONSTRAINT b FOREIGN KEY (tenant_id, parent_id) REFERENCES same_table(tenant_id, id),
CONSTRAINT a FOREIGN KEY (tenant_id) REFERENCES core.tenants(id)
```

This makes `core.tenants` the final value written to `tenant_id.reference_definition`, so it is correctly detected as a dependency.

Applied in: `database/ddl/table/edge/region_levels.ddl`

### Proper fix (in dbd)

`applyTableForeignKey` should accumulate **all** FK references per column rather than overwriting. The extractor should then emit one dependency per FK target, not just the last one written.

Alternatively, `_table_constraints` (already populated by `translateCreateStmt`) should be consumed by the extractor directly, independent of the per-column `reference_definition` mechanism.
