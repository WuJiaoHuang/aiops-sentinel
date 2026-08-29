package com.aiopssentinel.api.service;

import com.aiopssentinel.api.dto.DiagnosisTaskResponse;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class TaskCacheService {

  private static final Duration TASK_TTL = Duration.ofMinutes(30);
  private static final String KEY_PREFIX = "aiops:diagnosis-task:";

  private final StringRedisTemplate redisTemplate;
  private final ObjectMapper objectMapper;

  public TaskCacheService(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
    this.redisTemplate = redisTemplate;
    this.objectMapper = objectMapper;
  }

  public void cacheTask(DiagnosisTaskResponse task) {
    try {
      redisTemplate.opsForValue().set(key(task.taskId()), objectMapper.writeValueAsString(task), TASK_TTL);
    } catch (RuntimeException | JsonProcessingException ignored) {
      // Redis is an acceleration path; MySQL remains the source of truth.
    }
  }

  public Optional<DiagnosisTaskResponse> getCachedTask(String taskId) {
    try {
      String payload = redisTemplate.opsForValue().get(key(taskId));

      if (payload == null || payload.isBlank()) {
        return Optional.empty();
      }

      return Optional.of(objectMapper.readValue(payload, DiagnosisTaskResponse.class));
    } catch (RuntimeException | JsonProcessingException ignored) {
      return Optional.empty();
    }
  }

  private String key(String taskId) {
    return KEY_PREFIX + taskId;
  }
}
