package com.aiopssentinel.api.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "incidents")
public class IncidentEntity {

  @Id
  private String id;

  @Column(nullable = false)
  private String serviceId;

  @Column(nullable = false)
  private String title;

  @Column(nullable = false)
  private String severity;

  @Column(nullable = false)
  private String status;

  @Column(nullable = false)
  private Instant startedAt;

  @Column(nullable = false, length = 1024)
  private String summary;

  protected IncidentEntity() {
  }

  public IncidentEntity(
      String id,
      String serviceId,
      String title,
      String severity,
      String status,
      Instant startedAt,
      String summary) {
    this.id = id;
    this.serviceId = serviceId;
    this.title = title;
    this.severity = severity;
    this.status = status;
    this.startedAt = startedAt;
    this.summary = summary;
  }

  public String getId() {
    return id;
  }

  public String getServiceId() {
    return serviceId;
  }

  public String getTitle() {
    return title;
  }

  public String getSeverity() {
    return severity;
  }

  public String getStatus() {
    return status;
  }

  public Instant getStartedAt() {
    return startedAt;
  }

  public String getSummary() {
    return summary;
  }
}
