package com.aiopssentinel.api.service;

import com.aiopssentinel.api.dto.DiagnosisRequest;
import com.aiopssentinel.api.dto.DiagnosisTaskResponse;
import com.aiopssentinel.api.entity.DiagnosisTaskEntity;
import com.aiopssentinel.api.repository.DiagnosisTaskRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Service
public class DiagnosisGatewayService {

  private final RestClient aiServiceRestClient;
  private final DiagnosisTaskRepository diagnosisTaskRepository;
  private final TaskCacheService taskCacheService;
  private final AuditService auditService;
  private final ObjectMapper objectMapper;

  public DiagnosisGatewayService(
      RestClient aiServiceRestClient,
      DiagnosisTaskRepository diagnosisTaskRepository,
      TaskCacheService taskCacheService,
      AuditService auditService,
      ObjectMapper objectMapper) {
    this.aiServiceRestClient = aiServiceRestClient;
    this.diagnosisTaskRepository = diagnosisTaskRepository;
    this.taskCacheService = taskCacheService;
    this.auditService = auditService;
    this.objectMapper = objectMapper;
  }

  public DiagnosisTaskResponse createTask(DiagnosisRequest request) {
    String taskId = "java-task-" + UUID.randomUUID();
    Instant acceptedAt = Instant.now();
    List<String> pipeline = List.of(
        "spring-validation",
        "mysql-persist",
        "redis-task-cache",
        "mcp-agent-dispatch",
        "audit-trace");
    DiagnosisTaskResponse response = new DiagnosisTaskResponse(
        taskId,
        request.incidentId(),
        "accepted",
        "spring-boot",
        acceptedAt,
        pipeline,
        "redis-write-through");

    diagnosisTaskRepository.save(new DiagnosisTaskEntity(
        taskId,
        request.incidentId(),
        "accepted",
        "spring-boot",
        acceptedAt,
        toJson(pipeline)));
    taskCacheService.cacheTask(response);
    auditService.record(
        "create_diagnosis_task",
        request.operator() == null || request.operator().isBlank() ? "demo-user" : request.operator(),
        request.incidentId(),
        "通过 Java 网关创建诊断任务，任务状态写入 MySQL，并缓存到 Redis。");

    return response;
  }

  public Optional<DiagnosisTaskResponse> getTask(String taskId) {
    Optional<DiagnosisTaskResponse> cachedTask = taskCacheService.getCachedTask(taskId)
        .map(task -> new DiagnosisTaskResponse(
            task.taskId(),
            task.incidentId(),
            task.status(),
            task.gateway(),
            task.acceptedAt(),
            task.pipeline(),
            "redis"));

    if (cachedTask.isPresent()) {
      return cachedTask;
    }

    return diagnosisTaskRepository.findById(taskId).map(entity -> new DiagnosisTaskResponse(
        entity.getId(),
        entity.getIncidentId(),
        entity.getStatus(),
        entity.getGateway(),
        entity.getAcceptedAt(),
        fromJson(entity.getPipelineJson()),
        "mysql"));
  }

  public List<DiagnosisTaskResponse> listTasks(String incidentId) {
    List<DiagnosisTaskEntity> tasks = incidentId == null || incidentId.isBlank()
        ? diagnosisTaskRepository.findAll()
        : diagnosisTaskRepository.findByIncidentIdOrderByAcceptedAtDesc(incidentId);

    return tasks.stream()
        .map(entity -> new DiagnosisTaskResponse(
            entity.getId(),
            entity.getIncidentId(),
            entity.getStatus(),
            entity.getGateway(),
            entity.getAcceptedAt(),
            fromJson(entity.getPipelineJson()),
            "mysql"))
        .toList();
  }

  public Object proxyAiStatus() {
    return aiServiceRestClient.get()
        .uri("/api/ai/status")
        .retrieve()
        .body(Object.class);
  }

  private String toJson(List<String> pipeline) {
    try {
      return objectMapper.writeValueAsString(pipeline);
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("诊断任务 pipeline 序列化失败", error);
    }
  }

  private List<String> fromJson(String pipelineJson) {
    try {
      return objectMapper.readValue(
          pipelineJson,
          objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
    } catch (JsonProcessingException error) {
      return List.of();
    }
  }
}
