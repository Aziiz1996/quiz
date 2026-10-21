import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openStore, reserveLimits, cleanup } from './store.js';

const root = new URL('../', import.meta.url);
const publicFiles = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/register.html', ['register.html', 'text/html']], ['/registration.js', ['registration.js', 'text/javascript']],
  ['/registration.css', ['registration.css', 'text/css']], ['/auth-config.js', ['auth-config.js', 'text/javascript']],
  ['/business-administration.html', ['business-administration.html', 'text/html']],
  ['/purchasing-102.html', ['purchasing-102.html', 'text/html']],
  ['/inventory.html', ['inventory.html', 'text/html']],
  ['/sw.js', ['sw.js', 'text/javascript']], ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ...['favicon.png', 'apple-touch-icon.png', 'az-logistics-icon.png', 'icon-192.png', 'icon-512.png'].map(p => ['/' + p, [p, 'image/png']])
]);
const fail = (status, code) => Object.assign(new Error(code), { status });
const userView = u => ({ id: u.id, name: u.name, role: u.role, approval: u.approval, phoneVerified: Boolean(u.phone_verified_at) });

export function createApplication({ database, origin, key, provider = null, secureCookies = true,
  now = Date.now, dailySendLimit = 100 }) {
  if (!key || key.length < 32) throw new Error('APP_SECRET must contain at least 32 random characters');
  if (!origin || new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must be an exact origin');
  if (!Number.isSafeInteger(dailySendLimit) || dailySendLimit < 1) throw new Error('Invalid DAILY_SEND_LIMIT');
  const db = openStore(database);
  const digest = value => createHmac('sha256', key).update(value).digest('hex');
  const cookieName = secureCookies ? '__Host-azz_session' : 'azz_session';
  const cookie = (token, seconds) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secureCookies ? '; Secure' : ''}`;
  let nextCleanup = 0;
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw fail(401, 'AUTH_REQUIRED');
    const user = db.prepare(`SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id
      WHERE sessions.token_hash=? AND sessions.expires>?`).get(digest(token), now());
    if (!user) throw fail(401, 'AUTH_REQUIRED');
    return { user, token };
  }
  async function body(req) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'JSON_REQUIRED');
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 2048) throw fail(413, 'BODY_TOO_LARGE');
    }
    try {
      const value = JSON.parse(raw);
      if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
      return value;
    } catch { throw fail(400, 'INVALID_JSON'); }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    let challengeHash;
    try {
      const path = new URL(req.url, origin).pathname;
      if (path.startsWith('/api/') || path === '/healthz') {
        res.setHeader('Cache-Control', 'no-store');
        if (now() >= nextCleanup) { cleanup(db, now()); nextCleanup = now() + 60000; }
        // Ignore forwarded headers. The socket peer is authoritative; behind a proxy this is a shared limit.
        const ip = digest('ip:' + req.socket.remoteAddress);
        reserveLimits(db, [['request:' + ip, 120, 60000]], now());
        if (req.method === 'GET' && path === '/healthz') return json(200, { ok: true });
        if (req.method === 'GET' && path === '/api/config') return json(200, { verificationEnabled: Boolean(provider) });
        if (req.method === 'GET' && path === '/api/me') return json(200, { user: userView(session(req).user) });
        if (req.method === 'GET' && path === '/api/student/access') {
          const { user } = session(req);
          if (user.role !== 'student' || user.approval !== 'approved' || !user.phone_verified_at) throw fail(403, 'STUDENT_APPROVAL_REQUIRED');
          return json(200, { access: 'approved', message: 'تم اعتماد حساب الطالب. المحتوى الخاص سيضاف لاحقًا.' });
        }
        if (req.method !== 'POST') throw fail(404, 'NOT_FOUND');
        if (req.headers.origin !== origin) throw fail(403, 'ORIGIN_DENIED');
        const input = await body(req);
        if (path === '/api/logout') {
          const { token } = session(req);
          db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
          res.setHeader('Set-Cookie', cookie('', 0));
          return json(200, { ok: true });
        }
        if (!['/api/verify/start', '/api/verify/check'].includes(path)) throw fail(404, 'NOT_FOUND');
        if (!provider) throw fail(503, 'VERIFICATION_UNAVAILABLE');
        if (path === '/api/verify/start') {
          if (typeof input.phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(input.phone) || input.consent !== true) throw fail(400, 'INVALID_PHONE_OR_CONSENT');
          const name = input.name === undefined ? '' : input.name;
          if (typeof name !== 'string' || name.length > 100 || /[\x00-\x1f]/.test(name)) throw fail(400, 'INVALID_NAME');
          const phoneKey = digest('phone:' + input.phone);
          reserveLimits(db, [
            ['send-cooldown:' + phoneKey, 1, 60000], ['send-phone:' + phoneKey, 5, 3600000],
            ['send-ip:' + ip, 20, 3600000], ['send-global', dailySendLimit, 86400000]
          ], now());
          const token = randomBytes(32).toString('hex');
          const hash = digest(token);
          db.prepare('INSERT INTO challenges(token_hash,phone,name,expires) VALUES (?,?,?,?)').run(hash, input.phone, name.trim(), now() + 600000);
          try {
            const sid = await provider.send(input.phone);
            db.prepare("UPDATE challenges SET sid=?,state='pending' WHERE token_hash=?").run(sid, hash);
          } catch (error) { db.prepare('DELETE FROM challenges WHERE token_hash=?').run(hash); throw error; }
          return json(202, { challenge: token, retryAfter: 60, expiresIn: 600 });
        }
        if (typeof input.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(input.challenge) || typeof input.code !== 'string' || !/^\d{4,10}$/.test(input.code)) throw fail(400, 'INVALID_CODE');
        const hash = digest(input.challenge);
        const challenge = db.prepare('SELECT * FROM challenges WHERE token_hash=? AND expires>?').get(hash, now());
        if (!challenge || challenge.state !== 'pending') throw fail(400, 'CHALLENGE_EXPIRED');
        if (challenge.attempts >= 5) throw fail(429, 'TOO_MANY_ATTEMPTS');
        reserveLimits(db, [['check-ip:' + ip, 40, 600000], ['check-phone:' + digest(challenge.phone), 10, 600000]], now());
        // Claim synchronously before awaiting Twilio; concurrent checks cannot mint two sessions.
        const claimed = db.prepare("UPDATE challenges SET state='checking',attempts=attempts+1 WHERE token_hash=? AND state='pending' AND attempts<5").run(hash);
        if (!claimed.changes) throw fail(400, 'CHALLENGE_EXPIRED');
        challengeHash = hash;
        const status = await provider.check(challenge.sid, input.code);
        if (status !== 'approved') {
          db.prepare("UPDATE challenges SET state=? WHERE token_hash=?").run(status === 'pending' ? 'pending' : 'used', hash);
          challengeHash = undefined;
          throw fail(400, 'INVALID_CODE');
        }
        if (challenge.expires <= now()) throw fail(400, 'CHALLENGE_EXPIRED');
        const sessionToken = randomBytes(32).toString('hex');
        db.exec('BEGIN IMMEDIATE');
        let user;
        try {
          if (db.prepare('SELECT sid FROM consumed_verifications WHERE sid=?').get(challenge.sid)) throw fail(400, 'CHALLENGE_EXPIRED');
          db.prepare('INSERT INTO consumed_verifications VALUES (?,?)').run(challenge.sid, now() + 86400000);
          db.prepare(`INSERT INTO users(id,phone,name,phone_verified_at,created_at) VALUES (?,?,?,?,?)
            ON CONFLICT(phone) DO UPDATE SET phone_verified_at=excluded.phone_verified_at`).run(randomUUID(), challenge.phone, challenge.name, now(), now());
          user = db.prepare('SELECT * FROM users WHERE phone=?').get(challenge.phone);
          db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(sessionToken), user.id, now() + 8 * 3600000);
          db.prepare("UPDATE challenges SET state='used' WHERE token_hash=?").run(hash);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        challengeHash = undefined;
        res.setHeader('Set-Cookie', cookie(sessionToken, 8 * 3600));
        return json(200, { user: userView(user) });
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'METHOD_NOT_ALLOWED');
      const file = publicFiles.get(path);
      if (!file) throw fail(404, 'NOT_FOUND');
      if (path === '/register.html') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
      res.setHeader('Cache-Control', 'no-cache');
      const content = await readFile(fileURLToPath(new URL(file[0], root)));
      res.writeHead(200, { 'Content-Type': file[1] + (file[1].startsWith('text/') ? '; charset=utf-8' : '') });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (challengeHash) db.prepare("UPDATE challenges SET state='pending' WHERE token_hash=? AND state='checking'").run(challengeHash);
      const status = error.status || 500;
      if (status === 429) res.setHeader('Retry-After', String(error.retryAfter || 60));
      // Only stable, owned error codes leave the process, never provider or database messages.
      const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'INTERNAL_ERROR';
      if (!res.headersSent) json(status, { error: code });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { db, listen: (...args) => server.listen(...args), server };
}
