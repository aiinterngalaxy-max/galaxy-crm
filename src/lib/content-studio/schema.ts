// All dashboard tables are namespaced cmo_* so they never collide with the
// bot-server tables (todos, messages, drafts, reminders, qwen_work, ...).
//
// Model: Galaxy owns several BRANDS (internal properties — flagship brand,
// luxury villas, security, retail, founder's personal brand). Each brand can
// have several CHANNELS — one per social platform (its own Instagram, its own
// YouTube, etc.) with its own handle / follower count / sync status.
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS cmo_brands (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     category TEXT DEFAULT '',
     status TEXT DEFAULT 'Active',
     monthly_target INTEGER DEFAULT 8,
     lead TEXT DEFAULT '',
     notes TEXT DEFAULT '',
     created_at TEXT DEFAULT (datetime('now'))
   )`,

  // One row per brand+platform — the actual social account that publishes.
  `CREATE TABLE IF NOT EXISTS cmo_channels (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     brand_id INTEGER NOT NULL,
     platform TEXT NOT NULL,
     handle TEXT DEFAULT '',
     account_id TEXT DEFAULT '',
     follower_count INTEGER DEFAULT 0,
     last_synced TEXT,
     UNIQUE(brand_id, platform)
   )`,

  `CREATE TABLE IF NOT EXISTS cmo_content (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     brand_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     format TEXT DEFAULT 'Reel',
     platform TEXT DEFAULT 'Instagram',
     stage TEXT DEFAULT 'Idea',
     priority TEXT DEFAULT 'Normal',
     writer TEXT DEFAULT '',
     editor TEXT DEFAULT '',
     talent TEXT DEFAULT '',
     start_date TEXT,
     due_date TEXT,
     publish_date TEXT,
     shoot_date TEXT,
     location TEXT DEFAULT '',
     revision_rounds INTEGER DEFAULT 0,
     approved INTEGER DEFAULT 0,
     notes TEXT DEFAULT '',
     ext_platform TEXT DEFAULT '',
     ext_id TEXT DEFAULT '',
     ext_url TEXT DEFAULT '',
     source TEXT DEFAULT 'manual',
     created_at TEXT DEFAULT (datetime('now'))
   )`,

  // Script management as its own tracked entity (writer, deadline, revisions,
  // approval history) — one script per content piece.
  `CREATE TABLE IF NOT EXISTS cmo_scripts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     content_id INTEGER NOT NULL,
     writer TEXT DEFAULT '',
     status TEXT DEFAULT 'Pending',
     deadline TEXT,
     revision_count INTEGER DEFAULT 0,
     review_comments TEXT DEFAULT '',
     approved INTEGER DEFAULT 0,
     approved_at TEXT,
     created_at TEXT DEFAULT (datetime('now')),
     UNIQUE(content_id)
   )`,

  `CREATE TABLE IF NOT EXISTS cmo_ideas (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     brand_id INTEGER NOT NULL,
     month TEXT NOT NULL,
     title TEXT DEFAULT '',
     pitched INTEGER DEFAULT 0,
     pitch_due TEXT,
     approved INTEGER DEFAULT 0,
     rejected INTEGER DEFAULT 0,
     review_note TEXT DEFAULT '',
     content_id INTEGER,
     created_at TEXT DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS cmo_shoots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     brand_id INTEGER NOT NULL,
     content_id INTEGER,
     title TEXT NOT NULL,
     shoot_date TEXT,
     shoot_time TEXT DEFAULT '',
     location TEXT DEFAULT '',
     talent TEXT DEFAULT '',
     team TEXT DEFAULT '',
     equipment TEXT DEFAULT '',
     status TEXT DEFAULT 'Planned',
     notes TEXT DEFAULT ''
   )`,

  `CREATE TABLE IF NOT EXISTS cmo_performance (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     content_id INTEGER NOT NULL,
     views INTEGER DEFAULT 0,
     reach INTEGER DEFAULT 0,
     likes INTEGER DEFAULT 0,
     comments INTEGER DEFAULT 0,
     shares INTEGER DEFAULT 0,
     saves INTEGER DEFAULT 0,
     watch_time_sec INTEGER DEFAULT 0,
     clicks INTEGER DEFAULT 0,
     follower_growth INTEGER DEFAULT 0,
     captured_at TEXT DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS cmo_team (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     role TEXT DEFAULT '',
     capacity INTEGER DEFAULT 8,
     is_owner INTEGER DEFAULT 0
   )`,

  // Record of each sync run (for the dashboard status + debugging).
  `CREATE TABLE IF NOT EXISTS cmo_sync_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     platform TEXT,
     ok INTEGER DEFAULT 0,
     detail TEXT DEFAULT '',
     ts TEXT DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS cmo_comments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     content_id INTEGER NOT NULL,
     author TEXT NOT NULL DEFAULT '',
     text TEXT NOT NULL,
     created_at TEXT DEFAULT (datetime('now'))
   )`,

  `CREATE TABLE IF NOT EXISTS cmo_activity_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entity_type TEXT NOT NULL,
     entity_id INTEGER NOT NULL,
     action TEXT NOT NULL,
     detail TEXT DEFAULT '',
     actor TEXT DEFAULT 'System',
     created_at TEXT DEFAULT (datetime('now'))
   )`,
];

// Idempotent column adds (SQLite throws if the column already exists — caller
// runs these in try/catch). Lets us evolve tables without a reset.
export const MIGRATE: string[] = [
  "ALTER TABLE cmo_content ADD COLUMN priority TEXT DEFAULT 'Normal'",
  "ALTER TABLE cmo_ideas ADD COLUMN rejected INTEGER DEFAULT 0",
  "ALTER TABLE cmo_shoots ADD COLUMN shoot_time TEXT DEFAULT ''",
  "ALTER TABLE cmo_shoots ADD COLUMN team TEXT DEFAULT ''",
  "ALTER TABLE cmo_shoots ADD COLUMN equipment TEXT DEFAULT ''",
  "ALTER TABLE cmo_performance ADD COLUMN clicks INTEGER DEFAULT 0",
  "ALTER TABLE cmo_ideas ADD COLUMN review_note TEXT DEFAULT ''",
  "ALTER TABLE cmo_team ADD COLUMN is_owner INTEGER DEFAULT 0",
  "UPDATE cmo_team SET is_owner=1 WHERE name='Krish Shah'",
  "ALTER TABLE cmo_ideas ADD COLUMN content_id INTEGER",
  `CREATE TABLE IF NOT EXISTS cmo_activity_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entity_type TEXT NOT NULL,
     entity_id INTEGER NOT NULL,
     action TEXT NOT NULL,
     detail TEXT DEFAULT '',
     actor TEXT DEFAULT 'System',
     created_at TEXT DEFAULT (datetime('now'))
   )`,
];

// Drop everything (used by /api/init?reset=1) so re-seeding is clean.
export const DROP: string[] = [
  "DROP TABLE IF EXISTS cmo_activity_log",
  "DROP TABLE IF EXISTS cmo_comments",
  "DROP TABLE IF EXISTS cmo_sync_log",
  "DROP TABLE IF EXISTS cmo_channels",
  "DROP TABLE IF EXISTS cmo_accounts", // legacy name from the old client/account model
  "DROP TABLE IF EXISTS cmo_performance",
  "DROP TABLE IF EXISTS cmo_shoots",
  "DROP TABLE IF EXISTS cmo_scripts",
  "DROP TABLE IF EXISTS cmo_ideas",
  "DROP TABLE IF EXISTS cmo_content",
  "DROP TABLE IF EXISTS cmo_brands",
  "DROP TABLE IF EXISTS cmo_team",
  "DROP TABLE IF EXISTS cmo_clients", // legacy name from the old agency-client model
];
