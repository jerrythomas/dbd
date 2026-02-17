# DBD Architecture Guidelines

## Core Principles

### Functional Programming Approach

- **Pure Functions**: Functions should not have side effects
- **Immutable Data**: Prefer immutable data structures
- **Function Composition**: Build complex operations from simple functions
- **Predictable Behavior**: Same input always produces same output

### Separation of Concerns

- **Parser Layer**: SQL text → AST transformation
- **Extractor Layer**: AST → Schema objects
- **Business Layer**: Schema operations and workflows
- **Adapter Layer**: Database-specific implementations

## Parser Architecture

### Three-Layer Design

1. **SQL Parsing** (`parsers/sql.js`)

   - Splits SQL input into statements
   - Uses `node-sql-parser` for AST generation
   - Maintains original SQL for fallback extraction
   - Handles different statement types with specialized logic

2. **AST Extraction** (`extractors/`)

   - Table extractor - table definitions
   - View extractor - view definitions
   - Procedure extractor - stored procedures
   - Index extractor - database indexes
   - Each implements fallback regex-based extraction

3. **Functional API** (`index-functional.js`)
   - High-level schema extraction functions
   - Uses function composition for complex operations
   - Maintains pure functions with minimal side effects

### Error Handling Strategy

- **Structured Errors**: Use error objects instead of console warnings
- **Graceful Degradation**: Always attempt fallback extraction
- **Optional Logging**: Configurable logging that can be disabled
- **Error Collection**: Collect errors for later inspection

## Package Architecture

### Workspace Structure

```
packages/
├── parser/           # SQL parsing and schema extraction
├── cli/              # Command line interface
├── dbml/             # DBML conversion and transformation
└── db/               # Database operations abstraction

adapters/
└── postgres/         # PostgreSQL-specific operations
```

### Dependency Flow

```
cli → db → adapters/postgres
    → dbml → parser
    → parser
```

### Package Responsibilities

- **@dbd/parser**: Pure SQL parsing and schema extraction
- **dbd (CLI)**: User interface and orchestration
- **@dbd/dbml**: DBML conversion and schema transformation
- **@dbd/db**: Database operations abstraction
- **@dbd/db-postgres**: PostgreSQL adapter implementation

## Design Patterns

### Adapter Pattern

- Database-specific operations isolated in adapters
- Common interface through db package
- Easy to add new database support

### Strategy Pattern

- Multiple extraction strategies (AST vs regex)
- Configurable parsing approaches
- Fallback mechanisms for unsupported SQL

### Composition Pattern

- Build complex operations from simple functions
- Reusable extraction components
- Flexible schema processing pipelines

## Data Flow

### SQL Processing Pipeline

```
SQL Text → Parse → AST → Extract → Schema Objects → Transform → Output
```

### Error Recovery Pipeline

```
Parse Failure → Original SQL → Regex Extract → Partial Schema → Continue
```

### Schema Extraction Flow

```
1. Parse SQL statements
2. Attempt AST extraction
3. Fall back to regex if needed
4. Combine results into schema
5. Apply transformations
6. Return structured data
```

## Testing Strategy

### Test Structure

- **Unit Tests**: Individual component testing
- **Integration Tests**: Component interaction testing
- **Functional Tests**: End-to-end scenario testing

### Test Organization

```
spec/
├── basic/           # Unit tests for individual components
├── functional/      # Integration and end-to-end tests
└── fixtures/        # Test data and SQL samples
```

### Testing Principles

- Test both success and failure cases
- Include complex real-world SQL examples
- Verify error handling and fallback mechanisms
- Maintain test isolation and repeatability
