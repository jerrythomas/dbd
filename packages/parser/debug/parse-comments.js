// A debug script to test SQL comment parsing
import { SQLParser } from '../src/parser-utils.js'

// Create a new parser instance
const parser = new SQLParser()

// SQL with table and column comments
const sql = `
  CREATE TABLE users (
    id int PRIMARY KEY,
    name varchar(100)
  );
  
  COMMENT ON TABLE users IS 'User accounts table';
  COMMENT ON COLUMN users.id IS 'Primary key';
  COMMENT ON COLUMN users.name IS 'User display name';
`

console.log('Parsing SQL with comments...')
const ast = parser.parse(sql)

// Log the full AST to examine its structure
console.log('Full AST:')
console.log(JSON.stringify(ast, null, 2))

// Log specifically the COMMENT statements to see their structure
const commentStatements = ast.filter((stmt) => stmt.type === 'comment')
console.log('\nComment statements:')
console.log(JSON.stringify(commentStatements, null, 2))

// Extract tables and check if comments are processed
console.log('\nExtracting table definitions with comments...')
const tables = parser.extractTableDefinitions(ast)
console.log('Extracted tables with comments:')
console.log(JSON.stringify(tables, null, 2))
