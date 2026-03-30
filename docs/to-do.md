# To Do

- map imported staging tables to corresponding staging.import\_ procedures.
- use the dependency graph to run import procedures in sequence. staging tables have similar names to target tables, and we would have the dependency graph for the target tables. If we can map staging tables to their corresponding target tables then we can use the dependency graph of the target tables to identify the sequence in which to run the import procedures. This will help avoid the need of a loader.sql to be maintained with the sequence in which to call the import procedures.
