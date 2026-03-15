# dbd

[![Maintainability](https://api.codeclimate.com/v1/badges/55861d839f6d2c7f0c5e/maintainability)](https://codeclimate.com/github/jerrythomas/dbd/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/55861d839f6d2c7f0c5e/test_coverage)](https://codeclimate.com/github/jerrythomas/dbd/test_coverage)

A CLI tool for managing SQL database schemas. Apply individual DDL scripts to databases, load staging data, export data, and generate DBML documentation for [dbdocs.io](https://dbdocs.io).

- [x] Apply a set of individual DDL scripts to a database
- [x] Load staging data with post-process scripts for development/testing
- [x] Export data from tables & views
- [x] Generate [dbdocs](https://dbdocs.io) DBML for all (or subset) tables
- [x] Support for multiple schemas where names are unique across all schemas
- [x] Parse files and identify dependencies (e.g. views depend on tables)
- [x] Combine all scripts into a single file for deployment
- [ ] Support for multiple databases (e.g. postgres, mysql, mssql)
- [ ] Support for multiple schemas with the same names in multiple schemas

## Architecture

DBD is organized as a monorepo with focused packages:

```
packages/
  cli/       @jerrythomas/dbd                  — CLI, config, design orchestrator
  db/        @jerrythomas/dbd-db               — Database operations abstraction
  dbml/      @jerrythomas/dbd-dbml             — DBML conversion & documentation
  postgres/  @jerrythomas/dbd-postgres-adapter — PostgreSQL adapter (parser + psql)
config/      — Tool configs (vitest, eslint, prettier, bumpp)
```

### Dependency Flow

```
dbd (cli) -> dbd-db -> dbd-postgres-adapter
          -> dbd-dbml
```

## [Pre-requisites](docs/pre-requisites.md)

Refer to the pre-requisites document for setting up the dbd cli.

## Usage

Install the CLI globally using npm (or pnpm/yarn):

```bash
npm i --global @jerrythomas/dbd
```

### Folder Structure

Individual DDL scripts are expected to be placed under folders with names of the database object types. Subfolders are used to specify the schema names. Files are expected to have the same name as the object.

[example](example)

> Note: The CLI relies on dependencies mentioned in a YAML file (`design.yaml`) to execute scripts in sequence. Refer to the example folder.

### Commands

| Command     | Action                          |
| ----------- | ------------------------------- |
| dbd init    | Create an example repo          |
| dbd inspect | Inspect and report issues       |
| dbd combine | Combine all into single script  |
| dbd apply   | Apply the creation scripts      |
| dbd import  | Load seed/staging files         |
| dbd export  | Export tables/views             |
| dbd dbml    | Generate DBML files             |
| dbd graph   | Output dependency graph as JSON |

## LLM Documentation

Machine-readable docs for using dbd with AI assistants: [`docs/llms/`](docs/llms/)

## Development

```bash
# Install dependencies
bun install

# Run all unit tests
bun run test

# Run specific package tests
bun test:cli
bun test:db
bun test:dbml
bun test:postgres

# Coverage
bun run coverage

# Format and lint
bun run format
bun run lint
```

## Packages

| Package                                                | Description                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| [@jerrythomas/dbd](packages/cli)                       | CLI commands, configuration loading, Design class orchestration        |
| [@jerrythomas/dbd-db](packages/db)                     | Database adapter abstraction, entity processing, dependency resolution |
| [@jerrythomas/dbd-dbml](packages/dbml)                 | DBML conversion via @dbml/core with schema qualification               |
| [@jerrythomas/dbd-postgres-adapter](packages/postgres) | PostgreSQL adapter with SQL parser and reference classifier            |
