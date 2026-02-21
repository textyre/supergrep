// src/core/telemetry.ts
// OpenTelemetry tracing — no-op by default.
// Enable by setting OTEL_EXPORTER_OTLP_ENDPOINT.
// When enabled, install: @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node

export function initTelemetry(): void {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
  if (!endpoint) return
  // Dynamic import to avoid loading OTEL when not needed:
  // import('@opentelemetry/sdk-node').then(({ NodeSDK }) => { ... })
}
