-- DANGER: deletes every table (and all users' data). Only for starting over before launch.
--   npx wrangler d1 execute notice-board --remote --file=schema-reset.sql
DROP TABLE IF EXISTS media_chunks;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS user_data;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS abuse;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS plans;
