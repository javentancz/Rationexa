# Real-world case: Ingress NGINX retirement

This case tests whether Rationexa can preserve an accepted technical decision
and later identify authoritative evidence that weakens a key maintenance
assumption.

## Run it

1. Upload `decision.md` in Step 1.
2. Review the extracted premises. Confirm or correct them instead of accepting
   everything automatically.
3. Set criticality to `critical` and finalize the decision.
4. Paste the contents of `new-evidence.md` into Step 4 and run the revisit.

## Expected behavior

At least one finding should relate the retirement to the premise that the team
can operate and upgrade the controller. A reasonable relationship is
`contradicts` or `weakens`, depending on the exact extracted premise.

The result should retain this nuance:

- Existing deployments still function.
- Upstream maintenance and security fixes have stopped.
- Migration is recommended but is not a drop-in replacement.

The model should not claim that retirement automatically caused an outage or
that Gateway API is guaranteed to preserve every controller-specific behavior.
