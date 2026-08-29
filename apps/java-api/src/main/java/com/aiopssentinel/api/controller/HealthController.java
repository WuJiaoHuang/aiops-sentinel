package com.aiopssentinel.api.controller;

import com.aiopssentinel.api.dto.HealthResponse;
import java.time.Instant;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

  @GetMapping("/health")
  HealthResponse health() {
    return new HealthResponse("ok", "aiops-sentinel-java-api", Instant.now());
  }
}
