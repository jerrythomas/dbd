# @jerrythomas/dbd

A CLI tool for managing SQL database schemas. Apply individual DDL scripts to databases, load staging data, export data, and generate DBML documentation for [dbdocs.io](https://dbdocs.io).

## Installation

```bash
npm i --global @jerrythomas/dbd
```

## Usage

### Folder Structure

Individual DDL scripts are expected to be placed under folders with names of the database object types. Subfolders are used to specify the schema names. Files are expected to have the same name as the object.

> Note: The CLI relies on dependencies mentioned in a YAML file (`design.yaml`) to execute scripts in sequence.

### Commands

| Command     | Action                         |
| ----------- | ------------------------------ |
| dbd init    | Create an example repo         |
| dbd inspect | Inspect and report issues      |
| dbd combine | Combine all into single script |
| dbd apply   | Apply the creation scripts     |
| dbd import  | Load seed/staging files        |
| dbd export  | Export tables/views            |
| dbd dbml    | Generate DBML files            |

### Options

```
-c, --config       Provide path to custom config (default: design.yaml)
-d, --database     Database URL (default: $DATABASE_URL)
-e, --environment  Environment to load data (default: development)
-p, --preview      Preview the action
```

## Related Packages

| Package | Description |
| --- | --- |
| [@jerrythomas/dbd-db](https://www.npmjs.com/package/@jerrythomas/dbd-db) | Database operations abstraction |
| [@jerrythomas/dbd-dbml](https://www.npmjs.com/package/@jerrythomas/dbd-dbml) | DBML conversion & documentation |
| [@jerrythomas/dbd-postgres-adapter](https://www.npmjs.com/package/@jerrythomas/dbd-postgres-adapter) | PostgreSQL adapter |

## License

[MIT](LICENSE)
