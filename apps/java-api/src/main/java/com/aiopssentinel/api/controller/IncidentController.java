package com.aiopssentinel.api.controller;

import com.aiopssentinel.api.dto.IncidentResponse;
import com.aiopssentinel.api.service.IncidentService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/incidents")
public class IncidentController {

  private final IncidentService incidentService;

  public IncidentController(IncidentService incidentService) {
    this.incidentService = incidentService;
  }

  @GetMapping
  List<IncidentResponse> listIncidents(@RequestParam(required = false) String status) {
    return incidentService.listIncidents(status);
  }
}
