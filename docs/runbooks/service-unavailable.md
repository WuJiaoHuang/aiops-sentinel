# Service Unavailable

services:
- generic

keywords:
- unavailable
- down
- refused
- health
- actuator

Symptoms:
Requests to a service fail, health checks return DOWN, or clients receive connection refused, timeout, or fetch failed errors.

Checks:
Use service_health against the suspected service. Confirm whether the service process, port, database, cache, and discovery registration are healthy.

Mitigation:
Keep high-risk actions behind approval. Restore the service process or dependency only after operator confirmation, then watch error rate and latency for recovery.
