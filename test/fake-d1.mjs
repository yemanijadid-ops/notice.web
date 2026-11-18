// A tiny stand-in for Cloudflare D1 built on Node's built-in SQLite, only used for local tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const norm = (row) => (row ? { ...row } : null);
  function stmt(sql, args = []) {
    return {
      sql, args,
      bind: (...a) => stmt(sql, a),
      first: async () => norm(db.prepare(sql).get(...args)),
      all: async () => ({ results: db.prepare(sql).all(...args).map(norm) }),
      run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; }
    };
  }
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec('BEGIN');
      try { for (const s of stmts) db.prepare(s.sql).run(...s.args); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      return stmts.map(() => ({ success: true }));
    }
  };
}
