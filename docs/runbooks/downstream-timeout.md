# Downstream Timeout

services:
- generic

keywords:
- timeout
- retry
- downstream
- fallback
- degraded

Symptoms:
The affected service remains reachable, but a downstream call times out and the user-facing workflow becomes degraded.

Checks:
Search logs for timeout, retry, fallback, and downstream service names. Use dependency_trace to confirm whether the named downstream is a real dependency, then check that service with service_health.

Mitigation:
Reduce retry amplification, keep fallback enabled, and only request approval for rollback or restart recommendations. Do not execute dangerous actions automatically.
