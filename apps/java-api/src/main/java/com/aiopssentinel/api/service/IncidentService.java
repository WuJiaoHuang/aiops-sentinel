package com.aiopssentinel.api.service;

import com.aiopssentinel.api.dto.IncidentResponse;
import com.aiopssentinel.api.entity.IncidentEntity;
import com.aiopssentinel.api.repository.IncidentRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class IncidentService {

  private final IncidentRepository incidentRepository;

  public IncidentService(IncidentRepository incidentRepository) {
    this.incidentRepository = incidentRepository;
  }

  public List<IncidentResponse> listIncidents(String status) {
    List<IncidentEntity> incidents = status == null || status.isBlank()
        ? incidentRepository.findAll()
        : incidentRepository.findByStatusOrderByStartedAtDesc(status);

    return incidents.stream().map(this::toResponse).toList();
  }

  private IncidentResponse toResponse(IncidentEntity entity) {
    return new IncidentResponse(
        entity.getId(),
        entity.getServiceId(),
        entity.getTitle(),
        entity.getSeverity(),
        entity.getStatus(),
        entity.getStartedAt(),
        entity.getSummary());
  }
}
