# Choose PostgreSQL as the application database

Date: 2022-01-13

Status: Accepted

Source: https://github.com/tomorrowdevs-projects/team3-real-world-app/blob/4ddcbbd010e4b8dd276c165871a1c8be4902b25b/docs/decisions/ADR_database_001.md

## Context

The team needs a DBMS for a web application. Decision drivers include support
for the team's programming language, ease of learning, and storing large
files. PostgreSQL, Redis, and Elasticsearch were considered.

## Decision

Choose PostgreSQL because it is an open-source relational DBMS, the team can
implement the APIs quickly, and several contributors already know SQL.

## Consequences

More contributors can participate using existing SQL experience. Input data
must conform to a schema.

> Test adaptation: this file concisely restates the public ADR for evaluation.
> Follow the source link above for the complete original record.
