# Node.js 18 is end-of-life

Evidence date: 2025-03-27

Official sources:

- https://nodejs.org/en/about/previous-releases
- https://nodejs.org/en/about/eol

## New evidence

The Node.js project lists v18 (Hydrogen) as end-of-life, with its last update
on March 27, 2025. Node.js explains that an end-of-life release line no longer
receives updates, including security patches.

The official release page currently lists Node.js 24 as LTS. Production
applications should use an Active LTS or Maintenance LTS release.

## Why this matters

Pinning Node 18.18.2 no longer provides a supported production runtime. The
pin does not make the application stop immediately, but it creates security,
toolchain, and ecosystem-drift risk. The decision should be revisited and the
project should test a migration to a supported LTS release.

> Test adaptation: this file summarizes official Node.js lifecycle pages for
> evaluation. Follow the links above for the complete source material.
