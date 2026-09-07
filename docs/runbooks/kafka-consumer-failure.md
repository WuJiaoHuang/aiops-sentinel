# Kafka Consumer Failure

services:
- generic

keywords:
- kafka
- consumer
- lag
- dlt
- retry

Symptoms:
Asynchronous order or inventory workflows stop progressing, retries increase, or records move to a dead-letter topic.

Checks:
Check consumer logs, retry handlers, lag, and DLT counts. Confirm producer and consumer service health before changing offsets or replaying messages.

Mitigation:
Do not replay or delete records automatically. Produce a human-approved recovery plan with the exact topic, consumer group, and expected impact.
