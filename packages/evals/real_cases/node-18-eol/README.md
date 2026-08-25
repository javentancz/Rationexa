# Real-world case: Node.js 18 end-of-life

This case starts from a public 2023 ADR that pins Node 18.18.2 LTS, then adds
the Node.js project's official end-of-life evidence.

Expected behavior: Rationexa should flag the supported-runtime premise as
`supersedes`, `contradicts`, or `weakens`. It should not claim the application
has already stopped working.
