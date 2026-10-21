# AZZ LOGISTICS Analytics (optional service)

This is an isolated prototype. It does not alter the existing login or expose private student records. It accepts explicitly submitted aggregate input and requires an API key. Do not embed the key in browser code. Connect it only through an authenticated server-side endpoint with authorization checks.

Run locally: `pip install -r requirements.txt && ANALYTICS_API_KEY=local-secret uvicorn app:app --reload`.

Example: `curl -X POST http://localhost:8000/api/analytics/summary -H 'Content-Type: application/json' -H 'x-analytics-key: local-secret' -d '{"results":[{"course":"إدارة الأعمال","score":85}]}'`.

Kubernetes manifests are deployment templates only; replace image, hostname, GatewayClass, and create the secret and TLS certificate. No cluster or production deployment is configured. RAG/LLM integrations are intentionally not enabled until a secure content-access model and provider credentials are configured.
