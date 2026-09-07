import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ServiceMetadata, TargetConfig } from "../types";

type RawServiceMetadata = Partial<ServiceMetadata> & {
  dependencies?: string[];
};

type RawTargetConfig = Omit<Partial<TargetConfig>, "services"> & {
  services?: Record<string, RawServiceMetadata>;
};

const defaultTargets: Record<string, RawTargetConfig> = {
  cityeats: {
    name: "cityeats",
    type: "spring-boot",
    baseUrl: "http://localhost:8080",
    prometheusJob: "cityeats",
    logProvider: "file",
    logPath: "../CityEats/logs/cityeats.log",
    metricsProvider: "prometheus",
    healthProvider: "springboot",
    services: {
      cityeats: {
        framework: "spring-boot",
        dependencies: ["mysql", "redis", "rabbitmq"]
      }
    }
  },
  "demo-service": {
    name: "demo-service",
    type: "mock",
    metricsProvider: "mock",
    logProvider: "mock",
    healthProvider: "mock",
    services: {
      "svc-order": {
        framework: "spring-boot",
        dependencies: ["mysql", "redis"]
      }
    }
  },
  "nexus-commerce": {
    name: "nexus-commerce",
    type: "spring-boot",
    metricsProvider: "prometheus",
    logProvider: "file",
    healthProvider: "springboot",
    services: {
      "api-gateway": {
        framework: "spring-boot",
        baseUrl: "http://localhost:8183",
        logPath: "${NEXUS_COMMERCE_ROOT}/logs/api-gateway.log",
        dependencies: ["user-service", "product-service", "order-service", "inventory-service"]
      },
      "user-service": {
        framework: "spring-boot",
        baseUrl: "http://localhost:8180",
        logPath: "${NEXUS_COMMERCE_ROOT}/logs/user-service.log",
        dependencies: ["mysql", "kafka"]
      },
      "product-service": {
        framework: "spring-boot",
        baseUrl: "http://localhost:8081",
        logPath: "${NEXUS_COMMERCE_ROOT}/logs/product-service.log",
        dependencies: ["mysql", "redis", "kafka"]
      },
      "order-service": {
        framework: "spring-boot",
        baseUrl: "http://localhost:8084",
        logPath: "${NEXUS_COMMERCE_ROOT}/logs/order-service.log",
        dependencies: ["product-service", "inventory-service", "mysql", "kafka"]
      },
      "inventory-service": {
        framework: "spring-boot",
        baseUrl: "http://localhost:8085",
        logPath: "${NEXUS_COMMERCE_ROOT}/logs/inventory-service.log",
        dependencies: ["mysql", "redis", "kafka"]
      }
    }
  }
};

const targetConfigPath = () => path.resolve(process.cwd(), "config", "targets.yaml");

const expandEnv = (value: string | undefined) =>
  value?.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_match, name: string, fallback: string | undefined) =>
    process.env[name] ?? fallback ?? ""
  );

const normalizeTarget = (name: string, raw: RawTargetConfig): TargetConfig => {
  const services = Object.fromEntries(
    Object.entries(raw.services ?? {}).map(([serviceName, service]) => [
      serviceName,
      {
        ...service,
        baseUrl: expandEnv(service.baseUrl),
        logPath: expandEnv(service.logPath),
        dependencies: service.dependencies ?? []
      }
    ])
  );

  return {
    name,
    type: raw.type ?? "mock",
    baseUrl: expandEnv(raw.baseUrl),
    prometheusJob: raw.prometheusJob,
    logProvider: raw.logProvider,
    logPath: expandEnv(raw.logPath),
    metricsProvider: raw.metricsProvider,
    healthProvider: raw.healthProvider,
    services
  };
};

const parseValue = (value: string) => value.replace(/^['"]|['"]$/g, "");

const parseTargetsYaml = (content: string): Record<string, RawTargetConfig> => {
  const result: Record<string, RawTargetConfig> = {};
  let currentTarget: RawTargetConfig | undefined;
  let currentService: RawServiceMetadata | undefined;
  let currentList: string[] | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim() === "targets:") {
      continue;
    }

    const indent = line.match(/^ */)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (trimmed.startsWith("- ") && currentList) {
      currentList.push(parseValue(trimmed.slice(2).trim()));
      continue;
    }

    const match = trimmed.match(/^([^:]+):(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim();

    if (indent === 2 && !value) {
      currentTarget = { name: key, services: {} };
      result[key] = currentTarget;
      currentService = undefined;
      currentList = undefined;
      continue;
    }

    if (!currentTarget) {
      continue;
    }

    if (indent === 4) {
      if (key === "services") {
        currentTarget.services ??= {};
      } else {
        (currentTarget as Record<string, unknown>)[key] = parseValue(value);
      }
      currentService = undefined;
      currentList = undefined;
      continue;
    }

    if (indent === 6 && !value) {
      currentTarget.services ??= {};
      currentService = { dependencies: [] };
      currentTarget.services[key] = currentService;
      currentList = undefined;
      continue;
    }

    if (indent === 8 && currentService) {
      if (key === "dependencies") {
        currentService.dependencies = [];
        currentList = currentService.dependencies;
      } else {
        (currentService as Record<string, unknown>)[key] = parseValue(value);
        currentList = undefined;
      }
    }
  }

  return result;
};

const loadTargets = (): Record<string, TargetConfig> => {
  const configPath = targetConfigPath();
  const rawTargets = existsSync(configPath)
    ? parseTargetsYaml(readFileSync(configPath, "utf8"))
    : defaultTargets;

  return Object.fromEntries(
    Object.entries({ ...defaultTargets, ...rawTargets }).map(([name, target]) => [name, normalizeTarget(name, target)])
  );
};

export const getTargetConfig = (targetName?: string): TargetConfig => {
  const name = targetName ?? process.env.TARGET_SERVICE_NAME ?? "demo-service";
  const targets = loadTargets();
  const target = targets[name];

  if (!target) {
    throw new Error(`target ${name} 未配置`);
  }

  return target;
};

export const getServiceBaseUrl = (target: TargetConfig, service: string) =>
  target.services[service]?.baseUrl ?? target.baseUrl;

export const getServiceLogPath = (target: TargetConfig, service: string) =>
  target.services[service]?.logPath ?? target.logPath;
