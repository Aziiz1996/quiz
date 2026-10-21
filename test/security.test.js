import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../server/app.js';
import { openStore, reserveLimits } from '../server/store.js';
import { twilioProvider, VerifyProviderError } from '../server/twilio.js';
import { setApproval } from '../server/student-admin.js';

const credentials = { accountSid: 'AC' + '1'.repeat(32), authToken: 'test-only', serviceSid: 'VA' + '2'.repeat(32) };
const sid = 'VE' + '3'.repeat(32);

test('adapter uses form POST, server authentication and SID-bound approval', async () => {
  const calls = [];
  const provider = twilioProvider(credentials, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ sid, status: calls.length === 1 ? 'pending' : 'approved' });
  });
  assert.equal(await provider.send('+966500000001'), sid);
  assert.equal(await provider.check(sid, '123456'), 'approved');
  assert.equal(calls[0].url, `https://verify.twilio.com/v2/Services/${credentials.serviceSid}/Verifications`);
  assert.equal(calls[0].options.body.get('Channel'), 'sms');
  assert.equal(calls[0].options.body.get('To'), '+966500000001');
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(calls[1].options.body.get('VerificationSid'), sid);
  assert.equal(calls[1].options.body.get('Code'), '123456');
  assert.equal(calls[1].options.body.has('To'), false);
});

test('adapter fails closed for missing configuration, timeouts, errors and mismatched SID', async () => {
  assert.equal(twilioProvider({}), null);
  assert.throws(() => twilioProvider({ accountSid: credentials.accountSid }));
  for (const [upstream, expected] of [[404, 400], [429, 429], [500, 503], [401, 503]]) {
    const provider = twilioProvider(credentials, async () => new Response('sensitive upstream details', { status: upstream }));
    await assert.rejects(provider.send('+966500000001'), e => e.status === expected && !e.message.includes('sensitive'));
  }
  await assert.rejects(twilioProvider(credentials, async () => { throw Error('secret'); }).check(sid, '123456'), VerifyProviderError);
  await assert.rejects(twilioProvider(credentials, async () => Response.json({ sid: 'wrong', status: 'approved' })).check(sid, '123456'), VerifyProviderError);
});

test('rate limits survive reopening storage and roll back reservations together', () => {
  const directory = mkdtempSync(join(tmpdir(), 'azz-limits-'));
  try {
    let db = openStore(join(directory, 'test.sqlite'));
    reserveLimits(db, [['phone', 1, 60000]], 1000);
    db.close();
    db = openStore(join(directory, 'test.sqlite'));
    assert.throws(() => reserveLimits(db, [['global', 100, 60000], ['phone', 1, 60000]], 1001), e => e.status === 429);
    assert.equal(db.prepare("SELECT * FROM limits WHERE key='global'").get(), undefined);
    reserveLimits(db, [['phone', 1, 60000]], 61001);
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('operator approval is audited and cannot change a role or target a missing user', () => {
  const db = openStore(':memory:');
  db.prepare('INSERT INTO users(id,phone,name,phone_verified_at,created_at) VALUES (?,?,?,?,?)').run('student-1', '+966500000001', 'Student', 1, 1);
  setApproval(db, 'student-1', 'approved', 'operator-1', 2);
  assert.equal(db.prepare('SELECT role FROM users').get().role, 'student');
  assert.equal(db.prepare('SELECT actor FROM approval_audit').get().actor, 'operator-1');
  assert.throws(() => setApproval(db, 'student-1', 'admin', 'operator-1'));
  assert.throws(() => setApproval(db, 'missing', 'approved', 'operator-1'));
  db.close();
});

test('public HTTP server denies source/secrets and sets CSP and no-store headers', async t => {
  const app = createApplication({ database: ':memory:', origin: 'https://example.test', key: 'test-only'.repeat(8) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/.env', '/server/main.js', '/data/azz.sqlite', '/.git/config', '/package.json'])
    assert.equal((await fetch(base + path)).status, 404);
  const page = await fetch(base + '/register.html');
  assert.equal(page.status, 200);
  assert.equal((await fetch(base + '/inventory.html')).status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const me = await fetch(base + '/api/me');
  assert.equal(me.status, 401);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + '/api/verify/start', { method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: '{}' })).status, 503);
});
