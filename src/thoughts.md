# Thoughts

Different entities are created in different ways

- schema, extensions can be created with just the name
- role can be created using name or a file which has additional actions like grants
- table, view, function, procedure need file
- data can be loaded from json or csv.

## Approach

Convention

- DDL scripts are stored using the structure `ddl/<type>[/<schema>]/<name>.ddl`. Schema is optional for entities that are not associated with a schema.
- import files are expected in folder structure `import/<schema>/<name>.[csv|json]`. Only tables are allowed for import
- export files will be generated as `export/<schema>/<name>.[csv|json]`. export entities can be views or tables
- export entities need to be listed in some configuration file

Information available:

- export: schema and entity name.
- import: schema and entity name. Type is always table
- ddl: file name and dependency in configuration

```js
collect('ddl').analyze().group().sort().apply()
collect('export').analyze().filter().group().sort().apply()
collect('import').analyze().filter().group().sort().apply()
```
