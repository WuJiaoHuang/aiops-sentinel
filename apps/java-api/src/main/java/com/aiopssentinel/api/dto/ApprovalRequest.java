package com.aiopssentinel.api.dto;

import jakarta.validation.constraints.Size;

public record ApprovalRequest(
    @Size(max = 500)
    String comment,
    @Size(max = 120)
    String operator) {
}
