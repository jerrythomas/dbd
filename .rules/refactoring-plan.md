# DBD Refactoring Plan

## Overview

Refactoring the DBD codebase from a monolithic structure to a proper workspace with specialized packages. This enables better maintainability, testing, and future extensibility.

## Current Status: Phase 1 - Infrastructure Setup

### ✅ Completed

- **Parser Package**: Fully functional with comprehensive tests
- **Project Guidelines**: Organized .rules structure with clear documentation
- **Naming Conventions**: Established @dbd namespace and package standards

### 🔄 In Progress

- **Infrastructure Setup**: Creating workspace structure and package.json files

### 📋 Remaining Tasks

- Create package directories and configuration files
- Set up build and test scripts for each package
- Configure TypeScript/JSDoc for better type safety

## Refactoring Phases

### Phase 1: Infrastructure Setup (CURRENT)

**Goal**: Create proper workspace structure with package configurations

**Tasks**:

- [ ] Create workspace package.json with workspaces configuration
- [ ] Create packages/cli directory and package.json
- [ ] Create packages/dbml directory and package.json
- [ ] Create packages/db directory and package.json
- [ ] Create adapters/postgres directory and package.json
- [ ] Configure build and test scripts for each package
- [ ] Set up inter-package dependencies

### Phase 2: Extract Database Adapter

**Goal**: Move PostgreSQL-specific functionality to adapters/postgres

**Source Files to Move**:

- Parts of `src/entity.js` (DDL execution logic)
- PostgreSQL-specific constants from `src/constants.js`
- Database connection and transaction logic

**Target**: `@dbd/db-postgres` package

### Phase 3: Extract CLI Package

**Goal**: Move command-line interface to packages/cli

**Source Files to Move**:

- `src/index.js` (CLI entry point)
- `src/collect.js` (Design class orchestration)
- `src/metadata.js` (Configuration handling)
- CLI-specific constants and utilities

**Target**: `dbd` package (binary)

### Phase 4: Extract DBML Package

**Goal**: Move DBML conversion functionality to packages/dbml

**Source Files to Move**:

- DBML conversion logic (currently embedded)
- Schema combination functionality
- DBDocs integration features

**Target**: `@dbd/dbml` package

### Phase 5: Extract DB Package

**Goal**: Create database abstraction layer

**New Functionality**:

- Database operations abstraction
- Transaction management
- Connection pooling
- Error handling for database operations

**Target**: `@dbd/db` package

### Phase 6: Integration & Testing

**Goal**: Ensure all packages work together correctly

**Tasks**:

- Update all import statements
- Resolve circular dependencies
- Ensure all tests pass
- Update root package.json
- Create integration tests

## File Migration Map

| Current File        | Target Package    | Migration Type | Notes                            |
| ------------------- | ----------------- | -------------- | -------------------------------- |
| `src/index.js`      | `packages/cli`    | Move           | CLI entry point                  |
| `src/collect.js`    | `packages/cli`    | Move           | Design orchestration             |
| `src/entity.js`     | Split             | Move/Split     | Config → cli, Scripts → postgres |
| `src/parser.js`     | `packages/parser` | Enhance        | Add reference extraction         |
| `src/metadata.js`   | `packages/cli`    | Move           | Configuration handling           |
| `src/constants.js`  | Multiple          | Split          | Distribute to relevant packages  |
| `src/exclusions.js` | `packages/parser` | Move           | Parser utilities                 |
| `src/filler.js`     | TBD               | Investigate    | Unknown functionality            |

## Package Dependencies

### Dependency Graph

```
dbd (cli) → @dbd/db → @dbd/db-postgres
          → @dbd/dbml → @dbd/parser
          → @dbd/parser

@dbd/db → @dbd/db-postgres

@dbd/dbml → @dbd/parser
```

### External Dependencies

- **node-sql-parser**: Already used in parser package
- **@dbml/core**: For DBML conversion (to be added)
- **sade**: CLI framework (currently used)
- **pg**: PostgreSQL client (for adapter)

## Next Actions

### Immediate (Current Task)

1. Create workspace package.json with workspaces configuration
2. Create basic package.json for each new package
3. Set up build scripts and dependencies

### Following Tasks

1. Move PostgreSQL adapter code from entity.js
2. Extract CLI functionality from index.js and collect.js
3. Create DBML conversion package
4. Implement database abstraction layer

## Risk Mitigation

### Dependency Management

- Use exact versions for internal @dbd packages
- Lock external dependency versions
- Test all packages together in CI

### Backwards Compatibility

- Maintain current CLI interface during transition
- Keep existing configuration file formats
- Preserve all current functionality

### Testing Strategy

- Run existing tests continuously during refactoring
- Add integration tests for package interactions
- Test workspace builds and installations

## Success Criteria

- [ ] All existing functionality preserved
- [ ] All tests pass in new structure
- [ ] Clean separation of concerns between packages
- [ ] Proper dependency management
- [ ] Documentation updated for new structure
- [ ] CLI binary works identically to current version

## Timeline Estimate

- **Phase 1**: 1-2 days (Infrastructure Setup)
- **Phase 2**: 2-3 days (Database Adapter)
- **Phase 3**: 2-3 days (CLI Package)
- **Phase 4**: 1-2 days (DBML Package)
- **Phase 5**: 2-3 days (DB Package)
- **Phase 6**: 2-3 days (Integration & Testing)

**Total**: 10-16 days for complete refactoring
