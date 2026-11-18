-- Notice Board on Cloudflare D1 (SQLite). Run once:
--   npx wrangler d1 execute notice-board --remote --file=schema.sql
-- (If you ran an older version of this file before, run schema-reset.sql first.)

CREATE TABLE IF NOT EXISTS plans (
  key TEXT PRIMARY KEY,
  max_papers INTEGER NOT NULL,
  max_boards INTEGER NOT NULL,
  max_storage_bytes INTEGER NOT NULL
);
-- Placeholder numbers: change them any time with an UPDATE, no app change needed.
-- "Unlimited" is a very large number. Max is a placeholder until its details are decided.
INSERT OR IGNORE INTO plans (key, max_papers, max_boards, max_storage_bytes) VALUES
  ('guest', 10,      1, 20971520),
  ('free',  15,      1, 104857600),
  ('pro',   1000000, 3, 1610612736),
  ('max',   1000000, 3, 5368709120);

-- A person is either a full account (email + password) or a guest (no email, no password).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'guest')),
  email TEXT UNIQUE,
  pass_salt TEXT,
  pass_hash TEXT,       -- hash of (salt + the key the browser derives from the password); never the password
  recovery_hash TEXT,   -- hash of the one-time recovery code
  plan TEXT NOT NULL DEFAULT 'free' REFERENCES plans(key),
  terms_accepted_at TEXT,
  terms_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_kind_seen ON users(kind, last_seen);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One JSON document per user (the whole board, atlases and journal).
CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  papers_count INTEGER NOT NULL DEFAULT 0,
  boards_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Photos and voice notes: one row per file, the content is stored in pieces (base64 text) below.
CREATE TABLE IF NOT EXISTS media (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mime TEXT NOT NULL,
  chunks INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, name)
);
CREATE TABLE IF NOT EXISTS media_chunks (
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, name, idx),
  FOREIGN KEY (user_id, name) REFERENCES media(user_id, name) ON DELETE CASCADE
);

-- Marks used to slow down password guessing and guest/sign-up spam (cleaned daily).
CREATE TABLE IF NOT EXISTS abuse (
  key TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abuse_key_ts ON abuse(key, ts);
