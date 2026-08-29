package com.aiopssentinel.api.controller;

import com.aiopssentinel.api.dto.DiagnosisRequest;
import com.aiopssentinel.api.dto.DiagnosisTaskResponse;
import com.aiopssentinel.api.service.DiagnosisGatewayService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class DiagnosisController {

  private final DiagnosisGatewayService diagnosisGatewayService;

  public DiagnosisController(DiagnosisGatewayService diagnosisGatewayService) {
    this.diagnosisGatewayService = diagnosisGatewayService;
  }

  @GetMapping("/ai/status")
  Object aiStatus() {
    return diagnosisGatewayService.proxyAiStatus();
  }

  @PostMapping("/diagnosis-tasks")
  @ResponseStatus(HttpStatus.ACCEPTED)
  DiagnosisTaskResponse createDiagnosisTask(@Valid @RequestBody DiagnosisRequest request) {
    return diagnosisGatewayService.createTask(request);
  }

  @GetMapping("/diagnosis-tasks")
  List<DiagnosisTaskResponse> listDiagnosisTasks(@RequestParam(required = false) String incidentId) {
    return diagnosisGatewayService.listTasks(incidentId);
  }

  @GetMapping("/diagnosis-tasks/{taskId}")
  DiagnosisTaskResponse getDiagnosisTask(@PathVariable String taskId) {
    return diagnosisGatewayService.getTask(taskId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "诊断任务不存在"));
  }
}
