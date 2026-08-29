package com.aiopssentinel.api.repository;

import com.aiopssentinel.api.entity.IncidentEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface IncidentRepository extends JpaRepository<IncidentEntity, String> {

  List<IncidentEntity> findByStatusOrderByStartedAtDesc(String status);
}
