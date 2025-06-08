# DBD Naming Conventions

## Package Naming Standards

### Namespace: @dbd
All packages use the `@dbd` namespace for consistency and organization.

### Package Types

#### Core Packages
- **@dbd/parser** - SQL parsing and schema extraction
- **@dbd/dbml** - DBML conversion and transformation
- **@dbd/db** - Database operations abstraction

#### CLI Package
- **Package Name**: `dbd` (no namespace)
- **Binary Name**: `dbd`
- **Location**: `packages/cli/`

#### Database Adapters
- **Naming Pattern**: `@dbd/db-{database}`
- **Location Pattern**: `adapters/{database}/`
- **Examples**:
  - `@dbd/db-postgres` → `adapters/postgres/`
  - `@dbd/db-mysql` → `adapters/mysql/`
  - `@dbd/db-sqlite` → `adapters/sqlite/`

## Directory Structure

### Workspace Organization
```
dbd/
├── .rules/                 # Project guidelines and context
├── packages/
│   ├── parser/            # @dbd/parser
│   ├── cli/               # dbd (binary)
│   ├── dbml/              # @dbd/dbml
│   └── db/                # @dbd/db
└── adapters/
    ├── postgres/          # @dbd/db-postgres
    ├── mysql/             # @dbd/db-mysql
    └── sqlite/            # @dbd/db-sqlite
```

### Package Structure
```
package/
├── src/                   # Source code
├── spec/                  # Tests
├── package.json           # Package configuration
└── README.md              # Package documentation
```

## File Naming

### Source Files
- Use kebab-case for file names: `db-indexes.js`, `sql-parser.js`
- Use descriptive names that indicate purpose
- Group related functionality in folders

### Test Files
- Use `.spec.js` suffix for test files
- Mirror source structure in `spec/` directory
- Use descriptive test names that explain behavior

### Configuration Files
- Standard names: `package.json`, `README.md`, `.gitignore`
- Use lowercase for config files: `tsconfig.json`, `vitest.config.js`

## Code Naming

### Functions
- Use camelCase: `extractTables()`, `parseSQL()`
- Use descriptive verbs: `extract`, `parse`, `transform`, `validate`
- Prefer pure functions with clear input/output

### Variables
- Use camelCase: `sqlStatements`, `tableSchema`
- Use descriptive nouns that indicate data type
- Avoid abbreviations unless widely understood

### Constants
- Use UPPER_SNAKE_CASE: `DEFAULT_SCHEMA`, `MAX_RETRIES`
- Group related constants in objects
- Export from dedicated constants files

### Classes (when needed)
- Use PascalCase: `SqlParser`, `SchemaExtractor`
- Use descriptive nouns that indicate responsibility
- Prefer functional approach over classes when possible

## Import/Export Conventions

### Module Exports
```javascript
// Named exports for specific functions
export { extractTables, extractViews, extractIndexes };

// Default export for main functionality
export default parseSQL;
```

### Import Patterns
```javascript
// Import specific functions
import { extractTables } from '@dbd/parser';

// Import default export
import parseSQL from '@dbd/parser';

// Import everything (avoid when possible)
import * as parser from '@dbd/parser';
```

## Version Naming

### Semantic Versioning
- Follow semver: `MAJOR.MINOR.PATCH`
- Major: Breaking changes
- Minor: New features, backwards compatible
- Patch: Bug fixes, backwards compatible

### Package Dependencies
- Use exact versions for internal packages: `"@dbd/parser": "1.0.0"`
- Use ranges for external packages: `"lodash": "^4.17.21"`
- Lock versions in package-lock.json or bun.lockb

## Documentation Standards

### README Structure
1. Project description
2. Installation instructions
3. Usage examples
4. API documentation
5. Contributing guidelines

### Code Comments
- Use JSDoc for function documentation
- Include parameter types and return types
- Add examples for complex functions
- Avoid obvious comments

### Changelog
- Maintain CHANGELOG.md for each package
- Use conventional commit format
- Document breaking changes clearly