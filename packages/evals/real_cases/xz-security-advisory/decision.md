# Temporarily package a recent upstream XZ Utils release

Date: 2024-02-15

Status: Accepted

## Decision

Package a recent upstream XZ Utils release to obtain a required compatibility
fix before the Linux distribution publishes its package.

## Premises

- A recent upstream release is considered trustworthy after its published
  checksum is verified.
- The compatibility fix is required for the image build.
- Production dependencies must normally come from reviewed and signed
  distribution packages.

> Test adaptation: this fixture tests security evidence against a supply-chain
> trust assumption; it does not recommend using the affected versions.
