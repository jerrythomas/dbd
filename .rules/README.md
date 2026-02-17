# DBD Project Rules & Guidelines

This folder contains structured guidelines and context for working with the DBD (Database Designer) project. Use these files to understand the project structure, conventions, and current status.

## Quick Reference

- **[Project Overview](./project-overview.md)** - What DBD is and current achievements
- **[Architecture](./architecture.md)** - Technical architecture and patterns
- **[Naming Conventions](./naming-conventions.md)** - Package naming and organization standards
- **[Refactoring Plan](./refactoring-plan.md)** - Current refactoring status and next steps
- **[Development Guidelines](./development-guidelines.md)** - Development practices and patterns
- **[Testing Guidelines](./testing-guidelines.md)** - Testing approaches and standards

## Current Status

✅ **Parser Package** - Completed with comprehensive tests
✅ **Project Guidelines** - Organized .rules structure completed
🔄 **Workspace Refactoring** - Phase 1: Infrastructure Setup (READY TO START)

## Next Action

Ready to start Phase 1 of workspace refactoring: Create workspace package.json and individual package configurations following the established naming conventions.

## For LLM Assistants

When working on this project:

1. Read the relevant guideline files above
2. Follow the naming conventions and architecture patterns
3. Implement changes incrementally with tests
4. Update status in refactoring-plan.md
5. Confirm completion before moving to next step

## Workspace Structure

```
dbd/
├── .rules/                 # Guidelines and context
├── packages/
│   ├── parser/            # ✅ SQL parsing (@dbd/parser)
│   ├── cli/               # 🔄 CLI interface (dbd)
│   └── dbml/              # 🔄 DBML conversion (@dbd/dbml)
└── adapters/
    └── postgres/          # 🔄 PostgreSQL adapter (@dbd/db-postgres)
```
