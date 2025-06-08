// dbd/example/spec/parser/ddl-analyzer.spec.js
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SQLParser } from '../src/parser-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Skip these tests as they depend on actual files that don't exist
describe.skip('DDL Analyzer - Real World Examples', () => {
  const parser = new SQLParser('PostgreSQL');
  let fileCache = {};

  // Helper function to read a DDL file
  const readDdlFile = (relativePath) => {
    const fullPath = path.resolve(__dirname, '../../', relativePath);
    
    if (!fileCache[fullPath]) {
      fileCache[fullPath] = fs.readFileSync(fullPath, 'utf-8');
    }
    
    return fileCache[fullPath];
  };

  describe('Full Project Analysis', () => {
    let projectSchema;
    
    beforeAll(() => {
      const tablesConfig = [
        'ddl/table/config/lookups.ddl',
        'ddl/table/config/lookup_values.ddl'
      ];
      
      const tablesStaging = [
        'ddl/table/staging/lookups.ddl',
        'ddl/table/staging/lookup_values.ddl'
      ];
      
      const views = [
        'ddl/view/config/genders.ddl',
        'ddl/view/config/range_values.ddl',
        'ddl/view/migrate/lookup_values.ddl'
      ];
      
      const procedures = [
        'ddl/procedure/staging/import_jsonb_to_table.ddl',
        'ddl/procedure/staging/import_lookups.ddl',
        'ddl/procedure/staging/import_lookup_values.ddl'
      ];
      
      // Read and combine all DDL files
      const allDdlFiles = [...tablesConfig, ...tablesStaging, ...views, ...procedures];
      let combinedDdl = '';
      
      for (const filePath of allDdlFiles) {
        try {
          const content = readDdlFile(filePath);
          combinedDdl += content + '\n\n';
        } catch (err) {
          console.warn(`Couldn't read file ${filePath}: ${err.message}`);
        }
      }
      
      // Parse the combined DDL and extract schema
      projectSchema = parser.extractSchema(combinedDdl);
    });
    
    it('should extract all tables correctly', () => {
      expect(projectSchema.tables.length).toBeGreaterThanOrEqual(4);
      
      // Check for specific tables
      const tables = projectSchema.tables.map(t => `${t.schema || 'public'}.${t.name}`);
      expect(tables).toContain('config.lookups');
      expect(tables).toContain('config.lookup_values');
      expect(tables).toContain('staging.lookups');
      expect(tables).toContain('staging.lookup_values');
    });
    
    it('should extract all views correctly', () => {
      expect(projectSchema.views.length).toBeGreaterThanOrEqual(3);
      
      // Check for specific views
      const views = projectSchema.views.map(v => `${v.schema || 'public'}.${v.name}`);
      expect(views).toContain('config.genders');
      expect(views).toContain('config.range_values');
      expect(views).toContain('migrate.lookup_values');
    });
    
    it('should extract all procedures correctly', () => {
      expect(projectSchema.procedures.length).toBeGreaterThanOrEqual(3);
      
      // Check for specific procedures
      const procs = projectSchema.procedures.map(p => `${p.schema || 'public'}.${p.name}`);
      expect(procs).toContain('staging.import_jsonb_to_table');
      expect(procs).toContain('staging.import_lookups');
      expect(procs).toContain('staging.import_lookup_values');
    });
    
    it('should identify table relationships', () => {
      // Find lookup_values table
      const lookupValues = projectSchema.tables.find(t => 
        t.name === 'lookup_values' && t.schema === 'config'
      );
      
      expect(lookupValues).toBeDefined();
      
      // Check for foreign key to lookups table
      const lookupIdColumn = lookupValues.columns.find(c => c.name === 'lookup_id');
      expect(lookupIdColumn).toBeDefined();
      
      const fkConstraint = lookupIdColumn.constraints.find(c => c.type === 'FOREIGN KEY');
      expect(fkConstraint).toBeDefined();
      expect(fkConstraint.table).toBe('lookups');
    });
    
    it('should extract column data types correctly', () => {
      // Find lookups table
      const lookups = projectSchema.tables.find(t => 
        t.name === 'lookups' && t.schema === 'config'
      );
      
      expect(lookups).toBeDefined();
      
      // Check specific column data types
      const idColumn = lookups.columns.find(c => c.name === 'id');
      expect(idColumn.dataType).toContain('uuid');
      
      const nameColumn = lookups.columns.find(c => c.name === 'name');
      expect(nameColumn.dataType).toContain('varchar');
      
      const isEditableColumn = lookups.columns.find(c => c.name === 'is_editable');
      expect(isEditableColumn.dataType).toContain('boolean');
      
      const modifiedOnColumn = lookups.columns.find(c => c.name === 'modified_on');
      expect(modifiedOnColumn.dataType).toContain('timestamp with time zone');
    });
    
    it('should extract table and column comments', () => {
      // Find lookups table
      const lookups = projectSchema.tables.find(t => 
        t.name === 'lookups' && t.schema === 'config'
      );
      
      expect(lookups).toBeDefined();
      expect(lookups.comments.table).toBeDefined();
      expect(lookups.comments.table).toContain('Generic lookup table');
      
      // Check column comments
      expect(lookups.comments.columns).toBeDefined();
      expect(lookups.comments.columns['id']).toContain('Unique identifier');
      expect(lookups.comments.columns['name']).toContain('Name of the lookup');
    });
    
    it('should detect view dependencies', () => {
      // Find genders view
      const gendersView = projectSchema.views.find(v => 
        v.name === 'genders' && v.schema === 'config'
      );
      
      expect(gendersView).toBeDefined();
      expect(gendersView.dependencies.length).toBe(2);
      
      // Verify dependencies
      const tables = gendersView.dependencies.map(d => d.name);
      expect(tables).toContain('lookups');
      expect(tables).toContain('lookup_values');
    });
    
    it('should identify procedure parameters', () => {
      // Find import_jsonb_to_table procedure
      const jsonbProc = projectSchema.procedures.find(p => 
        p.name === 'import_jsonb_to_table' && p.schema === 'staging'
      );
      
      expect(jsonbProc).toBeDefined();
      expect(jsonbProc.parameters.length).toBe(2);
      
      // Check parameter details
      expect(jsonbProc.parameters[0].name).toBe('source');
      expect(jsonbProc.parameters[0].dataType).toBe('varchar');
      
      expect(jsonbProc.parameters[1].name).toBe('target');
      expect(jsonbProc.parameters[1].dataType).toBe('varchar');
    });
    
    it('should identify tables referenced in procedures', () => {
      // Find import_lookups procedure
      const importLookupsProc = projectSchema.procedures.find(p => 
        p.name === 'import_lookups' && p.schema === 'staging'
      );
      
      expect(importLookupsProc).toBeDefined();
      
      // Check table references
      expect(importLookupsProc.tableReferences).toBeDefined();
      expect(importLookupsProc.tableReferences).toContain('config.lookups');
      expect(importLookupsProc.tableReferences).toContain('staging.lookups');
    });
  });
  
  describe('Entity Relationship Map', () => {
    it('should generate a map of table relationships', () => {
      // Helper function to build entity relationship map
      const buildEntityRelationships = (schema) => {
        const relationships = [];
        
        for (const table of schema.tables) {
          const tableName = table.schema ? `${table.schema}.${table.name}` : table.name;
          
          // Find foreign key relationships
          for (const column of table.columns) {
            for (const constraint of column.constraints) {
              if (constraint.type === 'FOREIGN KEY') {
                const targetTable = constraint.schema ? 
                  `${constraint.schema}.${constraint.table}` : constraint.table;
                
                relationships.push({
                  source: tableName,
                  sourceColumn: column.name,
                  target: targetTable,
                  targetColumn: constraint.column || 'id',
                  relationship: '1:N' // Assuming most FKs represent one-to-many
                });
              }
            }
          }
        }
        
        return relationships;
      };
      
      // Read lookup tables DDL
      const ddl1 = readDdlFile('ddl/table/config/lookups.ddl');
      const ddl2 = readDdlFile('ddl/table/config/lookup_values.ddl');
      const combinedDdl = ddl1 + '\n\n' + ddl2;
      
      const schema = parser.extractSchema(combinedDdl);
      const relationships = buildEntityRelationships(schema);
      
      // Expect to find the relationship between lookups and lookup_values
      expect(relationships.length).toBeGreaterThan(0);
      
      const lookupRelation = relationships.find(r => 
        r.source.includes('lookup_values') && 
        r.target.includes('lookups')
      );
      
      expect(lookupRelation).toBeDefined();
      expect(lookupRelation.sourceColumn).toBe('lookup_id');
      expect(lookupRelation.targetColumn).toBe('id');
    });
  });
  
  describe('Dependency Graph', () => {
    it('should build a dependency graph for database objects', () => {
      // Helper function to build dependency graph
      const buildDependencyGraph = (schema) => {
        const graph = {};
        
        // Initialize graph with all objects
        for (const table of schema.tables) {
          const tableName = table.schema ? `${table.schema}.${table.name}` : table.name;
          graph[tableName] = { dependencies: [], dependents: [] };
        }
        
        for (const view of schema.views) {
          const viewName = view.schema ? `${view.schema}.${view.name}` : view.name;
          graph[viewName] = { dependencies: [], dependents: [] };
        }
        
        // Add dependencies for tables (from foreign keys)
        for (const table of schema.tables) {
          const tableName = table.schema ? `${table.schema}.${table.name}` : table.name;
          
          for (const column of table.columns) {
            for (const constraint of column.constraints) {
              if (constraint.type === 'FOREIGN KEY') {
                const targetTable = constraint.schema ? 
                  `${constraint.schema}.${constraint.table}` : constraint.table;
                
                if (graph[tableName] && graph[targetTable]) {
                  graph[tableName].dependencies.push(targetTable);
                  graph[targetTable].dependents.push(tableName);
                }
              }
            }
          }
        }
        
        // Add dependencies for views
        for (const view of schema.views) {
          const viewName = view.schema ? `${view.schema}.${view.name}` : view.name;
          
          for (const dep of view.dependencies) {
            const depName = dep.schema ? `${dep.schema}.${dep.name}` : dep.name;
            
            if (graph[viewName] && graph[depName]) {
              graph[viewName].dependencies.push(depName);
              graph[depName].dependents.push(viewName);
            }
          }
        }
        
        return graph;
      };
      
      // Generate a combined DDL with tables and views
      const ddlFiles = [
        'ddl/table/config/lookups.ddl',
        'ddl/table/config/lookup_values.ddl',
        'ddl/view/config/genders.ddl'
      ];
      
      let combinedDdl = '';
      for (const file of ddlFiles) {
        combinedDdl += readDdlFile(file) + '\n\n';
      }
      
      const schema = parser.extractSchema(combinedDdl);
      const dependencyGraph = buildDependencyGraph(schema);
      
      // Check that the graph has the expected objects
      expect(Object.keys(dependencyGraph).length).toBeGreaterThanOrEqual(3);
      expect(dependencyGraph['config.lookups']).toBeDefined();
      expect(dependencyGraph['config.lookup_values']).toBeDefined();
      expect(dependencyGraph['config.genders']).toBeDefined();
      
      // Check the dependencies
      expect(dependencyGraph['config.lookup_values'].dependencies).toContain('config.lookups');
      expect(dependencyGraph['config.lookups'].dependents).toContain('config.lookup_values');
      
      expect(dependencyGraph['config.genders'].dependencies).toContain('config.lookups');
      expect(dependencyGraph['config.genders'].dependencies).toContain('config.lookup_values');
      
      expect(dependencyGraph['config.lookups'].dependents).toContain('config.genders');
      expect(dependencyGraph['config.lookup_values'].dependents).toContain('config.genders');
    });
  });
  
  describe('Schema Differences', () => {
    it('should detect differences between similar tables in different schemas', () => {
      // Helper function to compare tables
      const compareTableSchemas = (table1, table2) => {
        const differences = {
          addedColumns: [],
          removedColumns: [],
          changedColumns: []
        };
        
        // Find columns in table2 that aren't in table1
        for (const col2 of table2.columns) {
          const col1 = table1.columns.find(c => c.name === col2.name);
          if (!col1) {
            differences.addedColumns.push(col2.name);
          } else if (col1.dataType !== col2.dataType || col1.nullable !== col2.nullable) {
            differences.changedColumns.push({
              name: col2.name,
              from: { dataType: col1.dataType, nullable: col1.nullable },
              to: { dataType: col2.dataType, nullable: col2.nullable }
            });
          }
        }
        
        // Find columns in table1 that aren't in table2
        for (const col1 of table1.columns) {
          const col2 = table2.columns.find(c => c.name === col1.name);
          if (!col2) {
            differences.removedColumns.push(col1.name);
          }
        }
        
        return differences;
      };
      
      // Read the lookup_values table from config and staging schemas
      const configDdl = readDdlFile('ddl/table/config/lookup_values.ddl');
      const stagingDdl = readDdlFile('ddl/table/staging/lookup_values.ddl');
      
      const configTable = parser.extractTableDefinitions(parser.parse(configDdl))[0];
      const stagingTable = parser.extractTableDefinitions(parser.parse(stagingDdl))[0];
      
      // Compare the tables
      const differences = compareTableSchemas(configTable, stagingTable);
      
      // Staging should be missing some columns that are in config
      expect(differences.removedColumns).toContain('id');
      expect(differences.removedColumns).toContain('lookup_id');
      
      // Staging should have 'name' column that config doesn't have
      expect(differences.addedColumns).toContain('name');
      
      // The 'modified_on' column might have a different data type
      const modifiedOnDiff = differences.changedColumns.find(c => c.name === 'modified_on');
      expect(modifiedOnDiff).toBeDefined();
    });
  });
});