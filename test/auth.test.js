import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server/app.js';

async function fixture(t, options = {}) {
  let now = 1700000000000;
  let sends = 0;
  const provider = {
    async send() { sends++; return 'VE' + String(sends).padStart(32, '0'); },
    async check(sid, code) { return code === '123456' ? 'approved' : 'pending'; }
  };
  const app = createApplication({ database: ':memory:', origin: 'http://127.0.0.1',
    secureCookies: false, key: 'test-only-key'.repeat(4), provider, now: () => now, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.db.close(); });
  async function request(path, body, cookie, origin = 'http://127.0.0.1') {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
      headers: { Origin: origin, ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body) });
    const data = await response.json();
    return { status: response.status, data, cookie: response.headers.get('set-cookie'), response };
  }
  return { app, request, advance: ms => now += ms, sends: () => sends };
}

test('phone approval creates a pending student; only independent admin approval grants access', async t => {
  const { app, request } = await fixture(t);
  const sent = await request('/api/verify/start', { phone: '+966500000001', name: 'Test Student', consent: true, role: 'admin', approved: true });
  assert.equal(sent.status, 202);
  const verified = await request('/api/verify/check', { challenge: sent.data.challenge, code: '123456' });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.user.role, 'student');
  assert.equal(verified.data.user.approval, 'pending');
  assert.match(verified.cookie, /HttpOnly/);
  assert.match(verified.cookie, /SameSite=Strict/);
  assert.equal((await request('/api/student/access', null, verified.cookie)).status, 403);
  app.db.prepare("UPDATE users SET approval='approved' WHERE id=?").run(verified.data.user.id);
  assert.equal((await request('/api/student/access', null, verified.cookie)).status, 200);
  app.db.prepare("UPDATE users SET approval='rejected' WHERE id=?").run(verified.data.user.id);
  assert.equal((await request('/api/student/access', null, verified.cookie)).status, 403);
  assert.equal((await request('/api/verify/check', { challenge: sent.data.challenge, code: '123456' })).status, 400);
});

test('wrong codes have a durable attempt ceiling and expired challenges fail', async t => {
  const { request, advance } = await fixture(t);
  const sent = await request('/api/verify/start', { phone: '+966500000002', consent: true });
  for (let i = 0; i < 5; i++) assert.equal((await request('/api/verify/check', { challenge: sent.data.challenge, code: '000000' })).status, 400);
  assert.equal((await request('/api/verify/check', { challenge: sent.data.challenge, code: '123456' })).status, 429);
  advance(61000);
  const next = await request('/api/verify/start', { phone: '+966500000003', consent: true });
  advance(600001);
  assert.equal((await request('/api/verify/check', { challenge: next.data.challenge, code: '123456' })).status, 400);
});

test('send cooldown, input validation, consent, origin checks and unavailable provider fail closed', async t => {
  const { request, sends } = await fixture(t);
  for (const body of [{ phone: '0500000000', consent: true }, { phone: '+966500000004' }])
    assert.equal((await request('/api/verify/start', body)).status, 400);
  assert.equal((await request('/api/verify/start', { phone: '+966500000004', consent: true }, null, 'https://evil.example')).status, 403);
  assert.equal(sends(), 0);
  assert.equal((await request('/api/verify/start', { phone: '+966500000004', consent: true })).status, 202);
  const limited = await request('/api/verify/start', { phone: '+966500000004', consent: true });
  assert.equal(limited.status, 429);
  assert.ok(limited.response.headers.get('retry-after'));
  const disabled = await fixture(t, { provider: null });
  assert.equal((await disabled.request('/api/verify/start', { phone: '+966500000005', consent: true })).status, 503);
});

test('sessions expire and logout revokes server-side access', async t => {
  const { request, advance } = await fixture(t);
  const sent = await request('/api/verify/start', { phone: '+966500000006', consent: true });
  const verified = await request('/api/verify/check', { challenge: sent.data.challenge, code: '123456' });
  assert.equal((await request('/api/me', null, verified.cookie)).status, 200);
  assert.equal((await request('/api/logout', {}, verified.cookie)).status, 200);
  assert.equal((await request('/api/me', null, verified.cookie)).status, 401);
  advance(61000);
  const next = await request('/api/verify/start', { phone: '+966500000006', consent: true });
  const login = await request('/api/verify/check', { challenge: next.data.challenge, code: '123456' });
  advance(8 * 3600000 + 1);
  assert.equal((await request('/api/me', null, login.cookie)).status, 401);
});
