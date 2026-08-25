# SQLite continues to promise file-format compatibility

Evidence date: 2026-08-01

Official sources:

- https://www.sqlite.org/onefile.html
- https://sqlite.org/c3ref/experimental.html

SQLite's documentation says all SQLite 3 releases can read and write database
files created by the first SQLite 3 release and promises backwards
compatibility for future SQLite 3 releases. It also states that stable
interfaces are maintained in a backwards-compatible way.

This evidence supports the portable-format premise. It does not address
concurrent-write capacity, so no relationship should be reported for that
separate premise.
