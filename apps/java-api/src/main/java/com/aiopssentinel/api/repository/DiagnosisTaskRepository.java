package com.aiopssentinel.api.repository;

import com.aiopssentinel.api.entity.DiagnosisTaskEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DiagnosisTaskRepository extends JpaRepository<DiagnosisTaskEntity, String> {

  List<DiagnosisTaskEntity> findByIncidentIdOrderByAcceptedAtDesc(String incidentId);
}
