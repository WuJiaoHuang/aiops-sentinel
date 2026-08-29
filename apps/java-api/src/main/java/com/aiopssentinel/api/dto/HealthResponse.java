package com.aiopssentinel.api.dto;

import java.time.Instant;

public record HealthResponse(
    String status,
    String service,
    Instant checkedAt) {
}
