package com.aiopssentinel.api.dto;

import java.time.Instant;
import java.util.List;

public record DiagnosisTaskResponse(
    String taskId,
    String incidentId,
    String status,
    String gateway,
    Instant acceptedAt,
    List<String> pipeline,
    String cacheSource) {
}
