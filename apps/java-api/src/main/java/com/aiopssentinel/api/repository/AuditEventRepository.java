package com.aiopssentinel.api.repository;

import com.aiopssentinel.api.entity.AuditEventEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditEventRepository extends JpaRepository<AuditEventEntity, String> {

  List<AuditEventEntity> findTop20ByOrderByCreatedAtDesc();
}
