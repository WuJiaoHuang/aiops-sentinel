package com.aiopssentinel.api.controller;

import com.aiopssentinel.api.dto.AuditEventResponse;
import com.aiopssentinel.api.service.AuditService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audit-events")
public class AuditController {

  private final AuditService auditService;

  public AuditController(AuditService auditService) {
    this.auditService = auditService;
  }

  @GetMapping
  List<AuditEventResponse> latest() {
    return auditService.latest();
  }
}
