# Backlog

Items deferred from the current phase. Reviewed periodically during housekeeping sessions.

---

## 1. Multi-Database Support

**Source:** README.md roadmap item

### What exists
- PostgreSQL adapter in `adapters/postgres/`
- Adapter pattern established in architecture

### What's needed
- [ ] MySQL adapter (`@dbd/db-mysql`)
- [ ] MSSQL adapter (`@dbd/db-mssql`)
- [ ] Common adapter interface in `@dbd/db`

---

## 2. Same-Name Tables Across Schemas

**Source:** README.md roadmap item

### What exists
- Schema-qualified names supported in parser
- Single-schema name uniqueness assumed

### What's needed
- [ ] Handle duplicate table names across different schemas
- [ ] Update dependency resolution for schema-qualified references

---

## 3. Workspace Refactoring (Phases 2-6)

**Source:** `.rules/refactoring-plan.md`

### What exists
- Phase 1 infrastructure partially set up
- Parser package complete
- Package directories created with package.json stubs

### What's needed
- [ ] Phase 2: Extract PostgreSQL adapter from `src/entity.js`
- [ ] Phase 3: Extract CLI from `src/index.js`, `src/collect.js`, `src/metadata.js`
- [ ] Phase 4: Extract DBML conversion to `packages/dbml`
- [ ] Phase 5: Create DB abstraction layer in `packages/db`
- [ ] Phase 6: Integration testing across all packages
