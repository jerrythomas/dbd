# DBD Testing Guidelines

## Testing Philosophy

### Core Principles

- **Test-Driven Development**: Write tests before or alongside implementation
- **Comprehensive Coverage**: Test both happy paths and error conditions
- **Realistic Scenarios**: Use real-world SQL examples in tests
- **Fast Feedback**: Tests should run quickly and provide clear feedback
- **Maintainable Tests**: Tests should be easy to understand and modify

### Testing Pyramid

1. **Unit Tests** (70%) - Test individual functions and components
2. **Integration Tests** (20%) - Test component interactions
3. **End-to-End Tests** (10%) - Test complete workflows

## Test Organization

### Directory Structure

```
package/
├── src/                   # Source code
├── spec/
│   ├── unit/             # Unit tests for individual modules
│   ├── integration/      # Integration tests
│   ├── fixtures/         # Test data and SQL samples
│   └── helpers/          # Test utilities and setup
```

### File Naming

- Use `.spec.js` suffix for test files
- Mirror source structure: `src/parser.js` → `spec/unit/parser.spec.js`
- Use descriptive names: `table-extraction.spec.js`, `error-handling.spec.js`

## Test Framework: Vitest

### Basic Test Structure

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { functionToTest } from '../src/module'

describe('Module Name', () => {
  beforeEach(() => {
    // Setup before each test
  })

  afterEach(() => {
    // Cleanup after each test
  })

  it('should perform expected behavior', () => {
    // Arrange
    const input = 'test input'

    // Act
    const result = functionToTest(input)

    // Assert
    expect(result).toBe('expected output')
  })
})
```

### Test Categories

#### Unit Tests

Test individual functions in isolation:

```javascript
describe('extractTableName', () => {
  it('should extract table name from simple CREATE TABLE', () => {
    const sql = 'CREATE TABLE users (id INT)'
    const result = extractTableName(sql)
    expect(result).toBe('users')
  })

  it('should handle schema-qualified table names', () => {
    const sql = 'CREATE TABLE public.users (id INT)'
    const result = extractTableName(sql)
    expect(result).toBe('public.users')
  })

  it('should return null for invalid SQL', () => {
    const sql = 'INVALID SQL'
    const result = extractTableName(sql)
    expect(result).toBeNull()
  })
})
```

#### Integration Tests

Test component interactions:

```javascript
describe('SQL Parser Integration', () => {
  it('should extract complete schema from complex SQL', () => {
    const sql = `
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE VIEW active_users AS SELECT * FROM users WHERE active = true;
      CREATE INDEX idx_users_email ON users(email);
    `

    const result = parseSQL(sql)

    expect(result.tables).toHaveLength(1)
    expect(result.views).toHaveLength(1)
    expect(result.indexes).toHaveLength(1)
  })
})
```

## Test Data Management

### Fixtures

Create reusable test data in `spec/fixtures/`:

```javascript
// spec/fixtures/sql-samples.js
export const simpleTable = `
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE
  );
`

export const complexSchema = `
  CREATE SCHEMA config;
  
  CREATE TABLE config.settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(255) NOT NULL,
    value JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  );
  
  COMMENT ON TABLE config.settings IS 'Application configuration settings';
`
```

### Test Helpers

Create utilities for common test operations:

```javascript
// spec/helpers/test-utils.js
export function createTestSQL(tables = [], views = []) {
  const tableSQL = tables.map((t) => `CREATE TABLE ${t.name} (${t.columns});`)
  const viewSQL = views.map((v) => `CREATE VIEW ${v.name} AS ${v.query};`)
  return [...tableSQL, ...viewSQL].join('\n')
}

export function expectTableStructure(table, expectedStructure) {
  expect(table).toHaveProperty('name', expectedStructure.name)
  expect(table).toHaveProperty('columns')
  expect(table.columns).toHaveLength(expectedStructure.columnCount)
}
```

## Error Testing

### Testing Error Conditions

Always test error scenarios:

```javascript
describe('Error Handling', () => {
  it('should handle malformed SQL gracefully', () => {
    const malformedSQL = 'CREATE TABLE incomplete ('

    const result = parseSQL(malformedSQL)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      type: 'ParseError',
      message: expect.stringContaining('malformed')
    })
  })

  it('should provide fallback extraction for unsupported SQL', () => {
    const complexSQL = 'CREATE PROCEDURE complex_proc() BEGIN SELECT 1; END;'

    const result = parseSQL(complexSQL)

    expect(result.procedures).toHaveLength(1)
    expect(result.errors).toHaveLength(0) // Should handle via fallback
  })
})
```

### Error Assertion Patterns

```javascript
// Test specific error types
expect(() => functionThatThrows()).toThrow(ParseError)
expect(() => functionThatThrows()).toThrow('Expected error message')

// Test error objects
const result = functionThatReturnsError()
expect(result.error).toMatchObject({
  type: 'ValidationError',
  code: 'INVALID_SQL',
  message: expect.stringContaining('syntax')
})
```

## Async Testing

### Testing Async Functions

```javascript
describe('Async Operations', () => {
  it('should handle async database operations', async () => {
    const result = await executeSQL('SELECT 1')
    expect(result.rows).toHaveLength(1)
  })

  it('should handle async errors', async () => {
    await expect(executeSQL('INVALID SQL')).rejects.toThrow()
  })
})
```

## Mock and Stub Guidelines

### When to Use Mocks

- External dependencies (databases, file system, APIs)
- Slow operations that would make tests slow
- Non-deterministic operations (random values, timestamps)

### Mock Examples

```javascript
import { vi } from 'vitest'

describe('Database Operations', () => {
  it('should execute SQL with mocked database', () => {
    const mockExecute = vi.fn().mockResolvedValue({ rows: [] })
    const db = { execute: mockExecute }

    const result = performQuery(db, 'SELECT * FROM users')

    expect(mockExecute).toHaveBeenCalledWith('SELECT * FROM users')
  })
})
```

## Performance Testing

### Testing Performance

```javascript
describe('Performance', () => {
  it('should parse large SQL files efficiently', () => {
    const largeSQLFile = generateLargeSQL(1000) // 1000 tables

    const startTime = performance.now()
    const result = parseSQL(largeSQLFile)
    const endTime = performance.now()

    expect(endTime - startTime).toBeLessThan(5000) // Less than 5 seconds
    expect(result.tables).toHaveLength(1000)
    expect(result.errors).toHaveLength(0)
  })
})
```

## Running Tests

### Test Scripts

Configure these scripts in package.json:

```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:ci": "vitest run",
    "test:coverage": "vitest --coverage",
    "test:ui": "vitest --ui"
  }
}
```

### Test Commands

```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run tests once (CI mode)
bun run test:ci

# Run with coverage report
bun run test:coverage

# Run specific test file
bun run test table-extraction.spec.js

# Run tests matching pattern
bun run test --grep "error handling"
```

## Test Quality Standards

### Coverage Requirements

- **Minimum Coverage**: 80% line coverage
- **Critical Paths**: 100% coverage for error handling
- **Edge Cases**: Test boundary conditions and edge cases
- **Regression Tests**: Add tests for every bug fix

### Test Quality Checklist

- [ ] Tests are independent and can run in any order
- [ ] Tests have descriptive names explaining what they verify
- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Error conditions are tested
- [ ] Tests use realistic data
- [ ] Tests run quickly (< 100ms each)
- [ ] Tests are maintainable and easy to understand

### Common Anti-Patterns to Avoid

- **Testing Implementation Details**: Test behavior, not internal structure
- **Overly Complex Tests**: Keep tests simple and focused
- **Shared State**: Avoid dependencies between tests
- **Magic Numbers**: Use descriptive constants instead of hardcoded values
- **Incomplete Assertions**: Always verify the expected outcome

## Continuous Integration

### CI Test Configuration

- Run tests on every push and pull request
- Test on multiple Node.js versions
- Generate and publish coverage reports
- Fail builds on test failures or coverage drops

### Test Environment

- Use consistent test environment across all developers
- Set up test database with known state
- Use environment variables for test configuration
- Clean up test data after each test run
