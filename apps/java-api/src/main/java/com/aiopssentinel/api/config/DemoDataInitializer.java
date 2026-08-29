package com.aiopssentinel.api.config;

import com.aiopssentinel.api.entity.IncidentEntity;
import com.aiopssentinel.api.repository.IncidentRepository;
import java.time.Instant;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DemoDataInitializer {

  @Bean
  CommandLineRunner seedIncidents(IncidentRepository incidentRepository) {
    return args -> {
      if (incidentRepository.existsById("inc-20260824-001")) {
        return;
      }

      incidentRepository.save(new IncidentEntity(
          "inc-20260824-001",
          "svc-order",
          "下单接口错误率突增",
          "critical",
          "investigating",
          Instant.parse("2026-08-24T08:12:00.000Z"),
          "最近一次发布后，下单接口错误率升至 12% 以上，影响支付确认链路。"));

      incidentRepository.save(new IncidentEntity(
          "inc-20260824-002",
          "svc-auth",
          "登录接口延迟超过 SLO",
          "warning",
          "open",
          Instant.parse("2026-08-24T09:25:00.000Z"),
          "移动端登录请求 P95 延迟超过 900ms，用户仍可登录但体验明显变慢。"));
    };
  }
}
