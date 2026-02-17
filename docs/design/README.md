# Design Documents

Module design documents — the "how" we're building it.

These are living documents that evolve with the implementation. Each document covers a specific module or cross-cutting concern. Update them when designs are agreed upon or when implementation reveals new patterns.

## Brownfield: Deriving Design from Existing Code

This is an existing project. Design documents should be **extracted** from the implementation, not invented.

### Sources
1. **Source code** (`packages/*/src/`, `src/`) — trace actual data flow
2. **`agents/design-patterns.md`** — established patterns already documented
3. **`.rules/architecture.md`** — legacy architecture reference
4. **Test fixtures** — reveal expected data shapes and edge cases

### Process
1. Pick a module/package to document
2. Read the source, trace the data flow from entry point to output
3. Identify: module boundaries, key functions, data structures, error handling
4. Write a design doc capturing the current implementation honestly
5. Flag technical debt where implementation diverges from ideal design
6. Include text-based diagrams where helpful (mermaid or ascii)

### What to include
- Module purpose and boundaries
- Data flow (input -> processing -> output)
- Key functions and their responsibilities
- Error handling approach
- Dependencies (internal and external)
- Known limitations and technical debt

### Naming
Use numbered files: `01-parser.md`, `02-cli.md`, `03-dbml.md`, etc.

## Documents

| # | Document | Description | Status |
|---|----------|-------------|--------|
| 01 | [01-parser.md](01-parser.md) | Parser — three-layer pipeline, extractors, error handling | Complete |
| 02 | [02-cli.md](02-cli.md) | CLI & orchestration — Design class, metadata, entity, execution | Active (legacy) |
| 03 | [03-configuration.md](03-configuration.md) | Configuration — design.yaml schema, project layout, entity lifecycle | Active |

## Architecture

Reference: `.rules/architecture.md` contains the original architecture documentation.
The design docs above supersede it with more detailed, code-derived documentation.
