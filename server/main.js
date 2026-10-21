import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApplication } from './app.js';
import { twilioProvider } from './twilio.js';

const production = process.env.NODE_ENV === 'production';
const origin = process.env.APP_ORIGIN || (production ? '' : 'http://localhost:3000');
if (production && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS');
const database = resolve(process.env.DATABASE_PATH || './data/azz.sqlite');
mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
const app = createApplication({ database, origin, key: process.env.APP_SECRET,
  secureCookies: production, dailySendLimit: Number(process.env.DAILY_SEND_LIMIT || 100),
  provider: twilioProvider({ accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN,
    serviceSid: process.env.TWILIO_VERIFY_SERVICE_SID }) });
app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('AZZ LOGISTICS server ready'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  app.server.close(() => { app.db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 15000).unref();
});
