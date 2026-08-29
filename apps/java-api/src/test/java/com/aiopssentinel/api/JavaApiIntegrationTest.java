package com.aiopssentinel.api;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class JavaApiIntegrationTest {

  @Autowired
  private MockMvc mockMvc;

  @Test
  void shouldSeedAndListIncidents() throws Exception {
    mockMvc.perform(get("/api/incidents"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(2)))
        .andExpect(jsonPath("$[0].id", notNullValue()));
  }

  @Test
  void shouldCreateDiagnosisTaskPersistItAndRecordAuditEvent() throws Exception {
    String body = """
        {
          "incidentId": "inc-20260824-001",
          "operator": "java-api-test",
          "source": "mockmvc"
        }
        """;

    String response = mockMvc.perform(post("/api/diagnosis-tasks")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.taskId", notNullValue()))
        .andExpect(jsonPath("$.gateway").value("spring-boot"))
        .andExpect(jsonPath("$.cacheSource").value("redis-write-through"))
        .andReturn()
        .getResponse()
        .getContentAsString();

    String taskId = response.replaceAll(".*\\\"taskId\\\":\\\"([^\\\"]+)\\\".*", "$1");

    mockMvc.perform(get("/api/diagnosis-tasks/{taskId}", taskId))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.taskId").value(taskId))
        .andExpect(jsonPath("$.cacheSource").value("mysql"));

    mockMvc.perform(get("/api/audit-events"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].action").value("create_diagnosis_task"))
        .andExpect(jsonPath("$[0].actor").value("java-api-test"));
  }
}
