package com.aiopssentinel.api.service;

import com.aiopssentinel.api.dto.AuditEventResponse;
import com.aiopssentinel.api.entity.AuditEventEntity;
import com.aiopssentinel.api.repository.AuditEventRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class AuditService {

  private final AuditEventRepository auditEventRepository;

  public AuditService(AuditEventRepository auditEventRepository) {
    this.auditEventRepository = auditEventRepository;
  }

  public void record(String action, String actor, String target, String detail) {
    auditEventRepository.save(new AuditEventEntity(
        UUID.randomUUID().toString(),
        action,
        actor,
        target,
        detail,
        Instant.now()));
  }

  public List<AuditEventResponse> latest() {
    return auditEventRepository.findTop20ByOrderByCreatedAtDesc().stream()
        .map(this::toResponse)
        .toList();
  }

  private AuditEventResponse toResponse(AuditEventEntity entity) {
    return new AuditEventResponse(
        entity.getId(),
        entity.getAction(),
        entity.getActor(),
        entity.getTarget(),
        entity.getDetail(),
        entity.getCreatedAt());
  }
}
