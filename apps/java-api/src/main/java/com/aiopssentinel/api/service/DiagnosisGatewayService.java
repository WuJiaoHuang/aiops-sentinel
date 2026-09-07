package com.aiopssentinel.api.service;

import com.aiopssentinel.api.dto.ApprovalRequest;
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
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

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
        "WAITING_FOR_APPROVAL",
        "spring-boot",
        acceptedAt,
        pipeline,
        "redis-write-through");

    diagnosisTaskRepository.save(new DiagnosisTaskEntity(
        taskId,
        request.incidentId(),
        "WAITING_FOR_APPROVAL",
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

  public DiagnosisTaskResponse approveTask(String taskId, ApprovalRequest request) {
    return decideTask(taskId, request, "APPROVED", "approval_approved", "人工批准高风险 ActionProposal。");
  }

  public DiagnosisTaskResponse rejectTask(String taskId, ApprovalRequest request) {
    return decideTask(taskId, request, "REJECTED", "approval_rejected", "人工拒绝高风险 ActionProposal。");
  }

  private DiagnosisTaskResponse decideTask(
      String taskId,
      ApprovalRequest request,
      String status,
      String auditAction,
      String auditDetail) {
    DiagnosisTaskEntity entity = diagnosisTaskRepository.findById(taskId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "诊断任务不存在"));

    if (!"WAITING_FOR_APPROVAL".equals(entity.getStatus())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "只有 WAITING_FOR_APPROVAL 状态的任务可以审批");
    }

    List<String> pipeline = new java.util.ArrayList<>(fromJson(entity.getPipelineJson()));
    pipeline.add(status);
    pipeline.add("agent-resume");
    entity.updateStatus(status, toJson(pipeline));
    diagnosisTaskRepository.save(entity);

    DiagnosisTaskResponse response = new DiagnosisTaskResponse(
        entity.getId(),
        entity.getIncidentId(),
        entity.getStatus(),
        entity.getGateway(),
        entity.getAcceptedAt(),
        pipeline,
        "mysql");
    taskCacheService.cacheTask(response);
    auditService.record(
        auditAction,
        request.operator() == null || request.operator().isBlank() ? "demo-user" : request.operator(),
        taskId,
        auditDetail + " comment=" + (request.comment() == null ? "" : request.comment()));
    auditService.record(
        "agent_resumed",
        request.operator() == null || request.operator().isBlank() ? "demo-user" : request.operator(),
        taskId,
        "审批结果已写入上下文，Agent 可继续生成最终建议，不自动执行危险动作。");

    return response;
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
