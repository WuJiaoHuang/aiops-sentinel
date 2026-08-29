package com.aiopssentinel.api.dto;

import java.time.Instant;

public record AuditEventResponse(
    String id,
    String action,
    String actor,
    String target,
    String detail,
    Instant createdAt) {
}
