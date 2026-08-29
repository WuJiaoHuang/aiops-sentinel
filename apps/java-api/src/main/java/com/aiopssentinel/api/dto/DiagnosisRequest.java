package com.aiopssentinel.api.dto;

import jakarta.validation.constraints.NotBlank;

public record DiagnosisRequest(
    @NotBlank String incidentId,
    String operator,
    String source) {
}
