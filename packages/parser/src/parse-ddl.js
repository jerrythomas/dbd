#!/usr/bin/env node
// dbd/example/spec/parser/parse-ddl.js

import { SQLParser } from './parser-utils.spec.js';
import fs from 'fs';
import path from 'path';

const USAGE = `
SQL DDL Parser Utility

Usage:
  bun run parse-ddl.js <ddl-file-path> [options]

Options:
  --format=json|yaml    Output format (default: json)
  --output=<file-path>  Output file (default: stdout)
  --tables-only         Extract only table definitions
  --views-only          Extract only view definitions
  --procedures-only     Extract only procedure definitions
  --no-comments         Exclude comments from output
  --detect-errors       Only check for parsing errors

Examples:
  bun run parse-ddl.js ../../ddl/table/config/lookups.ddl
  bun run parse-ddl.js ../../ddl/table/config/lookups.ddl --format=yaml --output=schema.yaml
  bun run parse-ddl.js ../../ddl/procedure/staging/import_lookups.ddl --procedures-only
`;

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const filePath = args[0];
const options = {
  format: 'json',
  output: null,
  tablesOnly: false,
  viewsOnly: false,
  proceduresOnly: false,
  includeComments: true,
  detectErrors: false
};

// Parse options
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  
  if (arg.startsWith('--format=')) {
    options.format = arg.split('=')[1];
    if (!['json', 'yaml'].includes(options.format)) {
      console.error(`Error: Invalid format '${options.format}'. Must be 'json' or 'yaml'.`);
      process.exit(1);
    }
  }
  else if (arg.startsWith('--output=')) {
    options.output = arg.split('=')[1];
  }
  else if (arg === '--tables-only') {
    options.tablesOnly = true;
  }
  else if (arg === '--views-only') {
    options.viewsOnly = true;
  }
  else if (arg === '--procedures-only') {
    options.proceduresOnly = true;
  }
  else if (arg === '--no-comments') {
    options.includeComments = false;
  }
  else if (arg === '--detect-errors') {
    options.detectErrors = true;
  }
  else {
    console.error(`Error: Unknown option '${arg}'`);
    console.log(USAGE);
    process.exit(1);
  }
}

// Read the DDL file
let ddlContent;
try {
  ddlContent = fs.readFileSync(filePath, 'utf-8');
} catch (err) {
  console.error(`Error reading file '${filePath}': ${err.message}`);
  process.exit(1);
}

// Create the SQL parser
const parser = new SQLParser('PostgreSQL');

// Process the DDL
try {
  if (options.detectErrors) {
    // Just check for errors without extracting metadata
    parser.parse(ddlContent);
    console.log(`✅ No syntax errors detected in '${filePath}'`);
    process.exit(0);
  }
  
  // Parse the DDL and extract the requested schema objects
  const ast = parser.parse(ddlContent);
  let result = {};
  
  if (options.tablesOnly) {
    result.tables = parser.extractTableDefinitions(ast);
  } else if (options.viewsOnly) {
    result.views = parser.extractViewDefinitions(ast);
  } else if (options.proceduresOnly) {
    result.procedures = parser.extractProcedureDefinitions(ast);
  } else {
    // Extract everything
    result = parser.extractSchema(ddlContent);
  }
  
  // Remove comments if requested
  if (!options.includeComments) {
    if (result.tables) {
      for (const table of result.tables) {
        delete table.comments;
      }
    }
  }
  
  // Format the output
  let output;
  if (options.format === 'json') {
    output = JSON.stringify(result, null, 2);
  } else if (options.format === 'yaml') {
    try {
      // Try to use js-yaml if available
      const yaml = await import('js-yaml');
      output = yaml.dump(result);
    } catch (err) {
      console.error('Error: js-yaml package not installed. Please install it with "npm install js-yaml"');
      process.exit(1);
    }
  }
  
  // Write the output
  if (options.output) {
    try {
      fs.writeFileSync(options.output, output);
      console.log(`✅ Schema extracted to '${options.output}'`);
    } catch (err) {
      console.error(`Error writing to '${options.output}': ${err.message}`);
      process.exit(1);
    }
  } else {
    // Print to stdout
    console.log(output);
  }
  
} catch (err) {
  console.error(`❌ Error parsing DDL: ${err.message}`);
  
  // Try to provide more context about the error
  if (err.location) {
    const lines = ddlContent.split('\n');
    const line = err.location.start.line;
    const column = err.location.start.column;
    
    console.error(`\nError at line ${line}, column ${column}:`);
    
    // Show the problematic line with a caret pointing to the error
    if (line > 0 && line <= lines.length) {
      const errorLine = lines[line - 1];
      console.error(errorLine);
      console.error(' '.repeat(column - 1) + '^');
    }
  }
  
  process.exit(1);
}