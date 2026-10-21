# Twilio Verify and the unified AZZ LOGISTICS site

The preferred deployment is the existing platform at https://aziz-leader.onrender.com, sourced from `Aziiz1996/Aziiz1996`. Its companion integration imports these public quizzes under `/quiz/` and hardens its existing signup flow. This repository's `auth-config.js` directs registration there; it contains only a public URL. Existing main-platform accounts remain the single account system.

GitHub Pages and the existing Render static site cannot execute the Node verification server. Do not put credentials into HTML, GitHub Pages configuration, `auth-config.js`, browser code or a public commit. No live SMS was tested.

## Standalone alternative

The `server/` implementation is a separate, optional standalone mode for this repository. It is **not** an account database migration or SSO bridge to the main platform. Do not deploy both account systems and describe them as one login.

`render.yaml` is an optional **paid** standalone example with a persistent disk and auto-deploys disabled. It has not been applied to your account. Its new service name avoids replacing the existing static site. Do not create it for the unified deployment; use the existing Leader service instead.

To run standalone instead, clear `window.AZZ_AUTH_ORIGIN`, set `window.AZZ_AUTH_PATH='/register.html'`, use Node 24, copy `.env.example` to an ignored `.env`, and generate a random `APP_SECRET` of at least 32 characters. Run `npm ci`, `npm test`, then `npm start`. Open the exact `APP_ORIGIN` (development default `http://localhost:3000`). All three Twilio settings blank means OTP is disabled. Partial/invalid configuration fails startup. There is no production fake-SMS switch.

Production additionally requires HTTPS, `NODE_ENV=production`, an exact `APP_ORIGIN`, a persistent writable `DATABASE_PATH`, one application instance, and consistent backups using SQLite's native backup facilities. Keep `APP_SECRET` stable: it protects opaque session/challenge hashes and private rate keys; rotating it signs out users and invalidates pending proofs and rate keys. Use a protected secret store. Database files contain phone numbers and names: protect disk and backup access. The static server uses an explicit public-file allowlist.

Provider calls are form-encoded server-side requests to Twilio Verify. Only `approved` is accepted, bound to the server-stored Verification SID. Challenges last ten minutes, permit five checks, and cannot be replayed. Sends are limited to one per phone per minute, five per phone per hour, twenty per socket IP per hour, and a global `DAILY_SEND_LIMIT` (100 by default). Limits persist in SQLite. Forwarded IP headers are ignored; behind a proxy the socket limit is shared and may need a verified proxy policy as traffic grows. Local limits supplement Twilio Fraud Guard, destination Geo Permissions, budget alerts and provider rate limits.

Verified phones create a `student` with `approval=pending`. Client-supplied roles/approval are ignored. `/api/student/access` rechecks current approval on every request. Admin approval is a separate server-operator action:

```sh
npm run student -- list
npm run student -- approved <student-id> <operator-name>
npm run student -- rejected <student-id> <operator-name>
```

Use these only in the running service's shell with its existing database mounted. Decisions are audited and never change the user's role. This implementation adds no private course content; public quizzes remain public. Phone-only login in standalone mode does not prove university enrollment or provide an admin login.

## Before enabling real SMS

Create a Twilio Verify service and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` in the backend secret store only. Confirm billing, permitted destinations, Fraud Guard and Verify's code lifetime. Trial recipients must meet Twilio's current trial restrictions. Use a phone you control to test delivery, incorrect/expired codes, resend throttling, successful verification, pending approval, independent approval, revocation and logout. A provider's accepted send request does not establish delivery.

References: [Twilio Verify](https://www.twilio.com/docs/verify/api/verification), [verification checks](https://www.twilio.com/docs/verify/api/verification-check), [Render persistent disks](https://render.com/docs/disks).
