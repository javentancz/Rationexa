# Use SQLite as the portable project format

Date: 2024-01-05

Status: Accepted

## Decision

Store each offline project in one SQLite 3 database file.

## Premises

- Users require a portable file that can be copied between supported desktop
  systems.
- SQLite 3 database files are expected to remain portable and backwards
  compatible.
- The application can tolerate a single-writer storage design.

> Test adaptation: this fixture tests evidence that positively supports a
> material premise rather than triggering a warning.
