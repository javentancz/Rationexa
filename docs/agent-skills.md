# Agent skills and the decision boundary

Rationexa agent skills extend the existing Import → Review → Finalize → Revisit
workflow. They do not replace it. Skills can read finalized records and submit
grounded evidence proposals; they cannot mutate organizational truth.

## Monitor an assumption

1. A human chooses one preserved premise.
2. A human approves one or more HTTPS source URLs.
3. An agent investigates those sources outside Rationexa.
4. The agent submits the source content, an exact excerpt, and a proposed
   relationship to the premise.
5. Rationexa rejects unapproved URLs and excerpts that cannot be located in the
   supplied source content. It stores the untouched source and character offsets.
6. A human chooses to keep the decision, request clarification, amend it,
   replace the selected option, dismiss the proposal, or create a ticket draft.

Creating a ticket draft only produces text inside Rationexa. It does not call a
ticketing system, send a message, or change the finalized decision.

## API sequence

Create a monitor:

```http
POST /v1/decisions/{decision_id}/monitors
Content-Type: application/json

{
  "premise_id": "...",
  "name": "Monitor vendor commitments",
  "instructions": "Watch for changes to the SAML delivery date.",
  "source_urls": ["https://vendor.example/roadmap"]
}
```

Submit a proposal from an agent skill:

```http
POST /v1/monitors/{monitor_id}/evidence-proposals
Content-Type: application/json

{
  "source_url": "https://vendor.example/roadmap",
  "source_title": "Vendor roadmap update",
  "source_content": "SAML support moved to next quarter.",
  "exact_excerpt": "SAML support moved to next quarter.",
  "relationship": "contradicts",
  "confidence_band": "high",
  "explanation": "The feature is now scheduled after the pilot.",
  "recommendation": "Revisit before signing the contract.",
  "submitted_by": "vendor-roadmap-skill"
}
```

Record the human outcome:

```http
POST /v1/monitor-evidence-proposals/{proposal_id}/human-action
Content-Type: application/json

{
  "action": "request_clarification",
  "notes": "Ask the vendor for a contractual delivery date."
}
```

These endpoints use the same workspace session boundary as the rest of the API.
An external agent integration should receive a narrowly scoped credential in a
future authorization layer; do not share a user password or provider model key.
