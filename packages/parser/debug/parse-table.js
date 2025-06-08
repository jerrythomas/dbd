// A simple debug script to test SQL parser functionality
import { SQLParser } from '../src/parser-utils.js';

// Create a new parser instance
const parser = new SQLParser();

// Define a simple CREATE TABLE statement
const simpleSQL = `
CREATE TABLE users (
  id int PRIMARY KEY,
  name varchar(100) NOT NULL,
  created_at timestamp DEFAULT now()
);
`;

// Parse the SQL
console.log('Parsing simple CREATE TABLE statement...');
const ast = parser.parse(simpleSQL);

// Log the AST structure
console.log('AST structure:');
console.log(JSON.stringify(ast, null, 2));

// Try to extract table definitions
console.log('\nExtracting table definitions...');
const tables = parser.extractTableDefinitions(ast);
console.log('Extracted tables:');
console.log(JSON.stringify(tables, null, 2));

// Test a more complex case with a foreign key
const foreignKeySQL = `
CREATE TABLE categories (
  id int PRIMARY KEY,
  name varchar(50)
);

CREATE TABLE products (
  id int PRIMARY KEY,
  name varchar(100),
  category_id int REFERENCES categories(id)
);
`;

console.log('\n\nParsing SQL with foreign key...');
const fkAst = parser.parse(foreignKeySQL);
console.log('First statement AST:');
console.log(JSON.stringify(fkAst[0], null, 2));
console.log('Second statement AST:');
console.log(JSON.stringify(fkAst[1], null, 2));

// Try to extract table definitions
console.log('\nExtracting table definitions from foreign key example...');
const fkTables = parser.extractTableDefinitions(fkAst);
console.log('Extracted tables:');
console.log(JSON.stringify(fkTables, null, 2));