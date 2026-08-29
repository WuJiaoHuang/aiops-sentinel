package com.aiopssentinel.api.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "diagnosis_tasks")
public class DiagnosisTaskEntity {

  @Id
  private String id;

  @Column(nullable = false)
  private String incidentId;

  @Column(nullable = false)
  private String status;

  @Column(nullable = false)
  private String gateway;

  @Column(nullable = false)
  private Instant acceptedAt;

  @Lob
  @Column(nullable = false)
  private String pipelineJson;

  protected DiagnosisTaskEntity() {
  }

  public DiagnosisTaskEntity(
      String id,
      String incidentId,
      String status,
      String gateway,
      Instant acceptedAt,
      String pipelineJson) {
    this.id = id;
    this.incidentId = incidentId;
    this.status = status;
    this.gateway = gateway;
    this.acceptedAt = acceptedAt;
    this.pipelineJson = pipelineJson;
  }

  public String getId() {
    return id;
  }

  public String getIncidentId() {
    return incidentId;
  }

  public String getStatus() {
    return status;
  }

  public String getGateway() {
    return gateway;
  }

  public Instant getAcceptedAt() {
    return acceptedAt;
  }

  public String getPipelineJson() {
    return pipelineJson;
  }
}
