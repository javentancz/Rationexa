# Start from Node 18 LTS

Date: 2023-11-18

Status: Accepted

Source: https://github.com/OleksandrKucherenko/webpack.config/blob/48de6d8e437ad0715015dc7b62f85ce84060bf06/doc/adr/0002-start-from-node-18-lts.md

## Context

The solution is used for composing a React application with modern features
enabled. The project needs a repeatable local Node.js toolchain.

## Decision

Use Direnv and Volta, and pin Node 18.18.2 LTS for the project.

## Consequences

The `.envrc` file enables Node 18.18.2 LTS. The pin assumes Node 18 remains a
supported production runtime. Moving to a newer major version will require a
deliberate toolchain and compatibility update.

> Test adaptation: this file concisely restates the public ADR for evaluation.
> Follow the source link above for the complete original record.
