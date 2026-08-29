package com.aiopssentinel.api.dto;

import java.time.Instant;

public record IncidentResponse(
    String id,
    String serviceId,
    String title,
    String severity,
    String status,
    Instant startedAt,
    String summary) {
}
