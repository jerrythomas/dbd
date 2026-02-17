# Requirements

Feature requirements — the "what" we're building.

These documents capture agreed-upon requirements. They serve as reference and are not typically updated after initial agreement. Implementation details belong in `docs/design/`.

## Brownfield: Deriving Requirements from Existing Code

This is an existing project. Requirements should be **extracted** from the codebase, not written from scratch.

### Sources (in priority order)
1. **Test suites** (`spec/`, `packages/*/spec/`) — most reliable behavioral spec
2. **README.md** — feature checklist and CLI command table
3. **Example folder** (`example/`) — expected usage patterns and folder structure
4. **Source code** (`src/`, `packages/*/src/`) — actual implemented behavior

### Process
1. Pick a module/package to document
2. Read its tests to understand what it does
3. Read its source to fill gaps the tests don't cover
4. Write a requirements doc focused on **observable behavior** (inputs, outputs, commands)
5. Mark any behavior that exists in code but has no test as "untested"

### Naming
Use numbered files: `01-parser.md`, `02-cli.md`, `03-dbml.md`, etc.

## Documents

*No requirements documents yet. Derive them incrementally as modules are worked on.*
