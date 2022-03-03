# Database Structure

```yaml
design:
  type: postgres
  name: project
  note: 'Something'

core:
  xyz:
    columns:
      a:
        type: b
        default: c
        nullable: d
        references: x
    indexes: a
      - c
      - d
    references:
      - name: x
        refers: y
        columns: d
```
