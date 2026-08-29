package com.aiopssentinel.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "aiops.ai-service")
public record AiServiceProperties(String baseUrl) {
}
