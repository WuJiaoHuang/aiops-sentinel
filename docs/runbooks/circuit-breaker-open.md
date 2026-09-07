# Circuit Breaker Open

services:
- generic

keywords:
- circuit
- breaker
- open
- fallback
- resilience4j

Symptoms:
The service starts returning fallback responses after repeated downstream failures or slow calls.

Checks:
Inspect Resilience4j metrics, application logs, and recent dependency health. Verify whether fallback protects the main workflow or hides a downstream outage.

Mitigation:
Keep traffic on the degraded path while collecting evidence. Any restart, rollback, or config change must become an ActionProposal and wait for approval.
