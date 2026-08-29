package com.aiopssentinel.api.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
@EnableConfigurationProperties(AiServiceProperties.class)
public class HttpClientConfig {

  @Bean
  RestClient aiServiceRestClient(AiServiceProperties properties) {
    return RestClient.builder()
        .baseUrl(properties.baseUrl())
        .build();
  }
}
