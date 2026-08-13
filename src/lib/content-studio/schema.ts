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

  // AI auto-edit job — one per content piece.
  //
  // Storage is Google Drive, not our own — the same per-user OAuth flow
  // Documents Upload already uses (src/lib/googleDrive.ts), so there is no
  // Cloudinary/Firebase-Storage size cap and no bill of ours to hit. The
  // *_drive_id columns are what let a re-open re-download the right file;
  // the *_view_url columns are just for a human clicking a link.
  //
  // The auto-edit itself runs in the browser via ffmpeg.wasm (silence/dead-air
  // removal) — no external API, no per-minute billing, nothing to configure.
  // It does not replicate a reference video's specific editing style; nothing
  // off-the-shelf does that. reference_url is stored purely as a note shown to
  // whoever is doing the Edit step, not fed into anything automatically.
  `CREATE TABLE IF NOT EXISTS cmo_video_jobs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     content_id INTEGER NOT NULL,
     reference_url TEXT DEFAULT '',
     raw_drive_id TEXT DEFAULT '',
     raw_view_url TEXT DEFAULT '',
     raw_name TEXT DEFAULT '',
     status TEXT DEFAULT 'Idle',
     silence_threshold_db REAL DEFAULT -30,
     min_silence_sec REAL DEFAULT 0.5,
     edited_drive_id TEXT DEFAULT '',
     edited_view_url TEXT DEFAULT '',
     trim_start REAL DEFAULT 0,
     trim_end REAL DEFAULT 0,
     caption_text TEXT DEFAULT '',
     caption_position TEXT DEFAULT 'bottom',
     export_drive_id TEXT DEFAULT '',
     export_view_url TEXT DEFAULT '',
     error TEXT DEFAULT '',
     regen_count INTEGER DEFAULT 0,
     approved INTEGER DEFAULT 0,
     approved_at TEXT,
     -- AI plan step (see api/content-studio/video-plan.ts): each is a JSON blob.
     link_analysis TEXT DEFAULT '',
     transcript TEXT DEFAULT '',
     edit_plan TEXT DEFAULT '',
     -- Set by joinClips when raw footage came from 2+ clips: JSON array of
     -- each original clip's [start,end] within the merged video, so it can
     -- be trimmed further per-clip after the fact without re-uploading.
     clip_segments TEXT DEFAULT '',
     created_at TEXT DEFAULT (datetime('now')),
     updated_at TEXT DEFAULT (datetime('now')),
     UNIQUE(content_id)
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

  // Idea → reference → script → captions. All of it hangs off the idea rather
  // than a new table: it is one row's worth of fields, and a join would buy
  // nothing but an extra query on every list.
  "ALTER TABLE cmo_ideas ADD COLUMN platform TEXT DEFAULT ''",
  "ALTER TABLE cmo_ideas ADD COLUMN reference_url TEXT DEFAULT ''",
  // JSON: what the reference post turned out to be — author, cover, caption.
  "ALTER TABLE cmo_ideas ADD COLUMN reference_meta TEXT DEFAULT ''",
  "ALTER TABLE cmo_ideas ADD COLUMN script_hook TEXT DEFAULT ''",
  "ALTER TABLE cmo_ideas ADD COLUMN script_body TEXT DEFAULT ''",
  "ALTER TABLE cmo_ideas ADD COLUMN script_cta TEXT DEFAULT ''",
  "ALTER TABLE cmo_ideas ADD COLUMN caption_examples TEXT DEFAULT ''",
  // JSON array of generated captions.
  "ALTER TABLE cmo_ideas ADD COLUMN captions TEXT DEFAULT ''",
  // TOFU / MOFU / BOFU — see FUNNEL_STAGES in stages.ts.
  "ALTER TABLE cmo_ideas ADD COLUMN funnel_stage TEXT DEFAULT ''",
  // 'reel' (hook/body/cta, short) or 'explainer' (long structured, bilingual).
  "ALTER TABLE cmo_ideas ADD COLUMN script_format TEXT DEFAULT 'reel'",
  "ALTER TABLE cmo_ideas ADD COLUMN script_full_en TEXT DEFAULT ''",
  "ALTER TABLE cmo_ideas ADD COLUMN script_full_hi TEXT DEFAULT ''",
  `CREATE TABLE IF NOT EXISTS cmo_activity_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entity_type TEXT NOT NULL,
     entity_id INTEGER NOT NULL,
     action TEXT NOT NULL,
     detail TEXT DEFAULT '',
     actor TEXT DEFAULT 'System',
     created_at TEXT DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS cmo_settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS cmo_video_jobs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     content_id INTEGER NOT NULL,
     reference_url TEXT DEFAULT '',
     raw_drive_id TEXT DEFAULT '',
     raw_view_url TEXT DEFAULT '',
     raw_name TEXT DEFAULT '',
     status TEXT DEFAULT 'Idle',
     silence_threshold_db REAL DEFAULT -30,
     min_silence_sec REAL DEFAULT 0.5,
     edited_drive_id TEXT DEFAULT '',
     edited_view_url TEXT DEFAULT '',
     trim_start REAL DEFAULT 0,
     trim_end REAL DEFAULT 0,
     caption_text TEXT DEFAULT '',
     caption_position TEXT DEFAULT 'bottom',
     export_drive_id TEXT DEFAULT '',
     export_view_url TEXT DEFAULT '',
     error TEXT DEFAULT '',
     regen_count INTEGER DEFAULT 0,
     approved INTEGER DEFAULT 0,
     approved_at TEXT,
     -- AI plan step (see api/content-studio/video-plan.ts): each is a JSON blob.
     link_analysis TEXT DEFAULT '',
     transcript TEXT DEFAULT '',
     edit_plan TEXT DEFAULT '',
     -- Set by joinClips when raw footage came from 2+ clips: JSON array of
     -- each original clip's [start,end] within the merged video, so it can
     -- be trimmed further per-clip after the fact without re-uploading.
     clip_segments TEXT DEFAULT '',
     created_at TEXT DEFAULT (datetime('now')),
     updated_at TEXT DEFAULT (datetime('now')),
     UNIQUE(content_id)
   )`,
  "ALTER TABLE cmo_video_jobs ADD COLUMN link_analysis TEXT DEFAULT ''",
  "ALTER TABLE cmo_video_jobs ADD COLUMN transcript TEXT DEFAULT ''",
  "ALTER TABLE cmo_video_jobs ADD COLUMN edit_plan TEXT DEFAULT ''",
  "ALTER TABLE cmo_video_jobs ADD COLUMN clip_segments TEXT DEFAULT ''",
  "ALTER TABLE cmo_video_jobs ADD COLUMN caption_position TEXT DEFAULT 'bottom'",
];

// Drop everything (used by /api/init?reset=1) so re-seeding is clean.
export const DROP: string[] = [
  "DROP TABLE IF EXISTS cmo_video_jobs",
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
