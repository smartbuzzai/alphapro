import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

let sdk: NodeSDK;

export function initTelemetry(): void {
  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'enterprise-api';
  const collectorUrl =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? 'development',
    }),

    traceExporter: new OTLPTraceExporter({
      url: `${collectorUrl}/v1/traces`,
    }),

    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${collectorUrl}/v1/metrics`,
      }),
      exportIntervalMillis: 15000,
    }),

    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-pg': { enabled: true },
        '@opentelemetry/instrumentation-redis': { enabled: true },
      }),
    ],
  });

  sdk.start();
  console.log(`🔭 OpenTelemetry initialized → ${collectorUrl}`);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk.shutdown().then(() => console.log('OTel SDK shut down cleanly'));
  });
}
