# DBD Development Guidelines

## Coding Standards

### General Principles
- **Clarity over Cleverness**: Write code that is easy to understand
- **Consistency**: Follow established patterns throughout the codebase
- **Maintainability**: Code should be easy to modify and extend
- **Performance**: Optimize for readability first, performance second

### Code Style

#### JavaScript/Node.js
- Use ES6+ features (modules, arrow functions, destructuring)
- Prefer `const` over `let`, avoid `var`
- Use template literals for string interpolation
- Use meaningful variable and function names

```javascript
// Good
const extractedTables = parseSQL(sqlStatement);
const { tables, views } = schemaResult;

// Avoid
let x = parseSQL(stmt);
var result = schemaResult.tables;
```

#### Function Design
- Keep functions small and focused (single responsibility)
- Prefer pure functions (no side effects)
- Use descriptive parameter names
- Return consistent data types

```javascript
// Good - Pure function with clear purpose
function extractTableName(astNode) {
  return astNode?.table?.name || null;
}

// Avoid - Side effects and unclear purpose
function processTable(node) {
  console.log('Processing:', node);
  globalTables.push(node);
  return node.name;
}
```

## Error Handling

### Structured Error Objects
- Use structured error objects instead of throwing strings
- Include context information in errors
- Provide error codes for programmatic handling

```javascript
// Good
class ParseError extends Error {
  constructor(message, sql, position) {
    super(message);
    this.name = 'ParseError';
    this.sql = sql;
    this.position = position;
  }
}

// Usage
function parseSQL(sql) {
  try {
    return parser.parse(sql);
  } catch (error) {
    throw new ParseError('Invalid SQL syntax', sql, error.position);
  }
}
```

### Graceful Degradation
- Always provide fallback mechanisms
- Log errors appropriately (configurable logging)
- Return partial results when possible

```javascript
function extractSchema(sql) {
  const result = { tables: [], views: [], errors: [] };
  
  try {
    result.tables = extractTables(sql);
  } catch (error) {
    result.errors.push(error);
    // Try fallback extraction
    result.tables = extractTablesRegex(sql);
  }
  
  return result;
}
```

## Testing Guidelines

### Test Structure
- Organize tests by functionality
- Use descriptive test names that explain behavior
- Follow Arrange-Act-Assert pattern

```javascript
describe('Table Extraction', () => {
  it('should extract table name from CREATE TABLE statement', () => {
    // Arrange
    const sql = 'CREATE TABLE users (id INT PRIMARY KEY)';
    
    // Act
    const result = extractTables(sql);
    
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('users');
  });
});
```

### Test Coverage
- Test happy path and error cases
- Include edge cases and boundary conditions
- Test both AST parsing and regex fallback paths
- Verify error handling and fallback mechanisms

### Test Data
- Use realistic SQL examples
- Include complex real-world scenarios
- Create reusable fixtures for common test cases
- Test with different SQL dialects when applicable

## Documentation Standards

### Code Documentation
- Use JSDoc for function documentation
- Document parameters, return values, and exceptions
- Include usage examples for complex functions

```javascript
/**
 * Extracts table definitions from SQL statements
 * @param {string} sql - The SQL statement to parse
 * @param {Object} options - Parsing options
 * @param {boolean} options.includeComments - Include table comments
 * @returns {Array<Object>} Array of table objects
 * @throws {ParseError} When SQL cannot be parsed
 * @example
 * const tables = extractTables('CREATE TABLE users (id INT)');
 * console.log(tables[0].name); // 'users'
 */
function extractTables(sql, options = {}) {
  // Implementation
}
```

### README Files
- Start with clear project description
- Include installation and usage instructions
- Provide API documentation with examples
- Document configuration options
- Include troubleshooting section

## Git Workflow

### Commit Messages
- Use conventional commit format
- Start with type: feat, fix, docs, style, refactor, test, chore
- Include scope when applicable
- Write clear, descriptive messages

```
feat(parser): add support for PostgreSQL JSONB columns
fix(cli): handle missing configuration file gracefully
docs(readme): update installation instructions
test(extract): add tests for complex SQL scenarios
```

### Branch Strategy
- Use feature branches for new functionality
- Keep branches focused and short-lived
- Use descriptive branch names
- Create pull requests for code review

```
feature/add-mysql-support
fix/parser-error-handling
refactor/extract-cli-package
```

## Performance Guidelines

### Parsing Optimization
- Cache parsed AST when processing multiple statements
- Use streaming for large SQL files
- Implement lazy evaluation where possible
- Profile parsing performance with large datasets

### Memory Management
- Avoid storing large objects in memory unnecessarily
- Use generators for processing large datasets
- Clean up resources appropriately
- Monitor memory usage in tests

## Security Considerations

### Input Validation
- Validate all external inputs
- Sanitize file paths and SQL inputs
- Avoid SQL injection in generated code
- Use parameterized queries when executing SQL

### Error Information
- Don't expose sensitive information in error messages
- Log security-relevant events appropriately
- Validate configuration files and options

## Package Development

### API Design
- Design consistent APIs across packages
- Use semantic versioning appropriately
- Maintain backwards compatibility when possible
- Document breaking changes clearly

### Dependencies
- Minimize external dependencies
- Use well-maintained, popular packages
- Lock dependency versions appropriately
- Regularly update and audit dependencies

### Publishing
- Test packages before publishing
- Include all necessary files in package
- Use .npmignore to exclude development files
- Follow semantic versioning for releases

## Code Review Guidelines

### Review Checklist
- [ ] Code follows style guidelines
- [ ] Functions are pure and focused
- [ ] Error handling is implemented
- [ ] Tests cover new functionality
- [ ] Documentation is updated
- [ ] No console.log statements in production code
- [ ] Performance impact is considered

### Review Process
- Review code for logic and design
- Check test coverage and quality
- Verify documentation accuracy
- Test functionality manually when needed
- Provide constructive feedback