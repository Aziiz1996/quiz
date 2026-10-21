import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore } from './store.js';

export function setApproval(db, id, decision, actor, now = Date.now()) {
  if (!['approved', 'rejected', 'pending'].includes(decision) || !actor?.trim() || actor.length > 100)
    throw new Error('Supply an approval decision and an operator name (max 100 characters)');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare("UPDATE users SET approval=? WHERE id=? AND role='student'").run(decision, id);
    if (!result.changes) throw new Error('Student not found');
    db.prepare('INSERT INTO approval_audit(user_id,decision,actor,at) VALUES (?,?,?,?)').run(id, decision, actor.trim(), now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, id, actor] = process.argv.slice(2);
  if (!['list', 'approved', 'rejected', 'pending'].includes(command)) {
    console.log('Usage: npm run student -- list | approved|rejected|pending <student-id> <operator-name>');
    process.exitCode = 1;
  } else {
    const path = resolve(process.env.DATABASE_PATH || './data/azz.sqlite');
    if (!existsSync(path)) throw new Error('DATABASE_PATH must point to the existing application database');
    const db = openStore(path);
    try {
      if (command === 'list') console.table(db.prepare('SELECT id,name,phone,role,approval FROM users ORDER BY created_at DESC LIMIT 100').all());
      else { setApproval(db, id, command, actor); console.log('Student approval updated and audited'); }
    } finally { db.close(); }
  }
}
