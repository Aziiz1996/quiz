# AZZ LOGISTICS — Twilio Verify
This branch adds a standalone SMS verification flow. The current website has **no student account database or role system**, so a verified phone does NOT create a user, grant student permissions, or prove enrollment.

## Local testing
Node.js 20+, then run `npm test` and `npm start`.

## Render hosting
Connect this repo to a Render Node web service using the existing render.yaml as a starting point.
Add these private Render environment variables (never commit credentials):
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_VERIFY_SERVICE_SID
- PUBLIC_ORIGIN=https://aziiz1996.github.io

Render sets PORT automatically. Point the `API` constant in verify.html to the actual HTTPS Render service URL once deployed. Until then, the form is intentionally disabled.

## Endpoints
POST /api/verify/start with JSON {"phone":"+966512345678"}
POST /api/verify/check with JSON {"phone":"+966512345678","code":"123456"}
GET /health

## Must do before real registration
Add secure student identity/session records and administrator approval, bind phone verification to a signed-in pending user on the server, persist approval state, and protect student resources on the server. Do not trust a browser's 'verified' response for authorization. Add shared Redis/IP/phone rate limits if running multiple backend instances, fraud protection and production monitoring. Tests mock Twilio responses: they do not send SMS.
