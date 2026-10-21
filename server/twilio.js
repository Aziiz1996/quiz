export class VerifyProviderError extends Error {
  constructor(status) { super('VERIFY_PROVIDER_ERROR'); this.status = status; }
}

export function twilioProvider({ accountSid, authToken, serviceSid }, fetcher = fetch) {
  if (!accountSid && !authToken && !serviceSid) return null;
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid || '') || !/^VA[0-9a-f]{32}$/i.test(serviceSid || '') || !authToken)
    throw new Error('Set valid server-side TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID');
  const base = `https://verify.twilio.com/v2/Services/${serviceSid}`;
  async function post(resource, fields) {
    let response;
    try {
      response = await fetcher(base + resource, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields)
      });
    } catch { throw new VerifyProviderError(503); }
    // Do not propagate Twilio payloads: they can include phone numbers and account details.
    if (!response.ok) throw new VerifyProviderError(response.status === 404 ? 400 : response.status === 429 ? 429 : 503);
    try { return await response.json(); } catch { throw new VerifyProviderError(503); }
  }
  return {
    async send(phone) {
      const result = await post('/Verifications', { To: phone, Channel: 'sms', Locale: 'ar' });
      if (result.status !== 'pending' || !/^VE[0-9a-f]{32}$/i.test(result.sid || '')) throw new VerifyProviderError(503);
      return result.sid;
    },
    async check(sid, code) {
      const result = await post('/VerificationCheck', { VerificationSid: sid, Code: code });
      if (result.sid !== sid) throw new VerifyProviderError(503);
      return result.status;
    }
  };
}
