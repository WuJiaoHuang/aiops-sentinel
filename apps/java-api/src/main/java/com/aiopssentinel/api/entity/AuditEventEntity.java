package com.aiopssentinel.api.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "audit_events")
public class AuditEventEntity {

  @Id
  private String id;

  @Column(nullable = false)
  private String action;

  @Column(nullable = false)
  private String actor;

  @Column(nullable = false)
  private String target;

  @Column(nullable = false, length = 1024)
  private String detail;

  @Column(nullable = false)
  private Instant createdAt;

  protected AuditEventEntity() {
  }

  public AuditEventEntity(String id, String action, String actor, String target, String detail, Instant createdAt) {
    this.id = id;
    this.action = action;
    this.actor = actor;
    this.target = target;
    this.detail = detail;
    this.createdAt = createdAt;
  }

  public String getId() {
    return id;
  }

  public String getAction() {
    return action;
  }

  public String getActor() {
    return actor;
  }

  public String getTarget() {
    return target;
  }

  public String getDetail() {
    return detail;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }
}
