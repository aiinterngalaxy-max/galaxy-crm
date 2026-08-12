// "Brands" are Galaxy-owned properties (Galaxy Home Automation, Galaxy
// Security, Founder's personal brand, ...) — NOT external agency clients.
export interface Brand {
  id: number;
  name: string;
  category: string; // e.g. "Flagship brand", "Premium villas", "Thought leadership"
  status: "Active" | "Onboarding" | "Paused" | "Retired";
  monthly_target: number; // content pieces required / month
  lead: string; // internal owner (team member)
  notes: string;
  created_at: string;
}

// One social account belonging to a brand (its Instagram, its YouTube, ...).
export interface Channel {
  id: number;
  brand_id: number;
  platform: string;
  handle: string;
  account_id: string;
  follower_count: number;
  last_synced: string | null;
}

export interface Content {
  id: number;
  brand_id: number;
  title: string;
  format: string; // Reel / Short / Long-form / Carousel / Post
  platform: string;
  stage: string;
  priority: "Low" | "Normal" | "High" | "Urgent";
  writer: string;
  editor: string;
  talent: string;
  start_date: string | null;
  due_date: string | null;
  publish_date: string | null;
  shoot_date: string | null;
  location: string;
  revision_rounds: number;
  approved: number; // 0/1 — current-stage approval
  notes: string;
  created_at: string;
  ext_platform?: string;
  ext_id?: string;
  ext_url?: string;
  source?: string; // 'manual' | 'sync'
}

export interface ContentScript {
  id: number;
  content_id: number;
  writer: string;
  status: "Pending" | "In Progress" | "Submitted" | "Changes Required" | "Approved";
  deadline: string | null;
  revision_count: number;
  review_comments: string;
  approved: number;
  approved_at: string | null;
  created_at: string;
}

export interface Idea {
  id: number;
  brand_id: number;
  month: string; // YYYY-MM
  title: string;
  pitched: number; // 0/1
  pitch_due: string | null;
  approved: number; // 0/1
  rejected: number; // 0/1
  review_note: string;
  content_id: number | null;
  created_at: string;
  // Creative workflow: reference post → script → captions.
  platform?: string;
  /** TOFU / MOFU / BOFU — see FUNNEL_STAGES in stages.ts. */
  funnel_stage?: string;
  reference_url?: string;
  /** JSON string — see ReferenceMeta. */
  reference_meta?: string;
  script_hook?: string;
  script_body?: string;
  script_cta?: string;
  /** 'reel' (default, hook/body/cta) or 'explainer' (long structured, bilingual). */
  script_format?: string;
  script_full_en?: string;
  script_full_hi?: string;
  caption_examples?: string;
  /** JSON string — array of generated captions. */
  captions?: string;
}

/** What a reference post turned out to be, once looked up. */
export interface ReferenceMeta {
  author?: string;
  thumbnail?: string;
  caption?: string;
  provider?: string;
  /** What the AI made of the cover and caption. */
  analysis?: string;
  /** What the AI found trending in this niche right now, via a live web search — not just this one post. */
  trends?: string;
}

export interface Shoot {
  id: number;
  brand_id: number;
  content_id: number | null;
  title: string;
  shoot_date: string | null;
  shoot_time: string;
  location: string;
  talent: string;
  team: string;
  equipment: string;
  status: "Planned" | "Scheduled" | "Completed" | "Cancelled";
  notes: string;
}

export interface Performance {
  id: number;
  content_id: number;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watch_time_sec: number;
  clicks: number;
  follower_growth: number;
  captured_at: string;
}

export interface TeamMember {
  id: number;
  name: string;
  role: string; // Writer / Editor / Strategist / Shooter / Lead
  capacity: number; // pieces they can handle in flight
  is_owner: number; // 0/1 — Owner can approve/reject pitched ideas
}

// Joined / derived shapes used by the UI
export interface ContentRow extends Content {
  brand_name: string;
}

export interface PerfRow extends Performance {
  title: string;
  brand_name: string;
  platform: string;
  source?: string;
  publish_date?: string | null;
}

export interface ActivityEntry {
  id: number;
  entity_type: "content" | "brand" | "idea" | "script" | "shoot" | "sync";
  entity_id: number;
  action: string;
  detail: string;
  actor: string | null;
  created_at: string;
}

export interface SearchResult {
  id: number;
  type: "Content" | "Idea" | "Script" | "Shoot" | "Brand";
  title: string;
  meta: string;
  href: string;
}

export interface ScriptRow extends ContentScript {
  title: string;
  brand_name: string;
}

export interface ShootRow extends Shoot {
  brand_name: string;
}

export interface ContentComment {
  id: number;
  content_id: number;
  author: string;
  text: string;
  created_at: string;
}

// Where an auto-edit job is in its lifecycle. Drives which controls the modal
// shows, so every state the UI can be in has to be one of these.
export type VideoJobStatus =
  | "Idle" // row exists, no footage uploaded yet
  | "Uploading" // footage going to Drive
  | "Analyzing" // reading the referral link + transcribing the footage
  | "Planning" // AI is turning the analysis into an editing plan
  | "Generating" // ffmpeg.wasm is removing silence, in the browser
  | "Generated" // an edited draft exists — Edit / Change / Regenerate
  | "Exporting" // applying trim/caption, rendering the final file
  | "Exported" // export_view_url is the final, downloadable video
  | "Failed";

export interface VideoJob {
  id: number;
  content_id: number;
  // Shown to whoever does the Edit step as a guide, AND (if it resolves)
  // analyzed by AI into link_analysis for the editing plan below.
  reference_url: string;
  raw_drive_id: string;
  raw_view_url: string;
  raw_name: string;
  status: VideoJobStatus;
  // Auto-edit tuning: silencedetect's noise floor (dB) and minimum gap length
  // (seconds) before a stretch counts as "dead air" worth cutting.
  silence_threshold_db: number;
  min_silence_sec: number;
  edited_drive_id: string;
  edited_view_url: string;
  trim_start: number;
  trim_end: number;
  caption_text: string;
  export_drive_id: string;
  export_view_url: string;
  error: string;
  regen_count: number;
  approved: number; // 0/1 — gates Export
  approved_at: string | null;
  // JSON blobs from the AI plan step (api/content-studio/video-plan.ts) —
  // stored as strings so a bad/empty response never breaks a column read.
  link_analysis: string;
  transcript: string;
  edit_plan: string;
  created_at: string;
  updated_at: string;
}

export interface StageCount {
  stage: string;
  count: number;
}

export interface Stats {
  activeBrands: number;
  totalBrands: number;
  inProduction: number;
  publishedThisMonth: number;
  overdueCount: number;
  overdue: ContentRow[];
  upcomingShoots: ShootRow[];
  pendingApprovals: ContentRow[];
  byStage: StageCount[];
  ideasRequired: number;
  ideasPitched: number;
  totals: { views: number; reach: number; engagement: number; followers: number };
  perf: PerfRow[];
  monthlyTargetTotal: number;
  monthlyCompletionPct: number;
  avgTurnaround: number | null;
}

export interface Insights {
  bestFormats: { format: string; avgEngRate: number; n: number }[];
  bestPlatforms: { platform: string; avgViews: number; n: number }[];
  bestDays: { day: string; avgViews: number; n: number }[];
  bottlenecks: { stage: string; avgAge: number; count: number }[];
  teamEfficiency: { person: string; avgRevisions: number; n: number }[];
}

export interface SyncStatusEntry {
  key: string;
  label: string;
  connected: boolean;
}

export interface SyncLogEntry {
  ok: boolean;
  platform: string;
  detail: string;
  ts: string;
}
