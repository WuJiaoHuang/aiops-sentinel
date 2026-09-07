# High Error Rate

services:
- generic

keywords:
- error
- rate
- 5xx
- http_error_rate
- rollback

Symptoms:
HTTP 5xx percentage rises above the service SLO and affects a user-facing workflow.

Checks:
Query http_error_rate as a percentage, compare it with latency and recent logs, and identify whether errors come from the affected service or one of its dependencies.

Mitigation:
If rollback is proposed, create an ActionProposal with HIGH risk and require operator approval. Approval records consent for the recommendation; it does not execute the rollback.
