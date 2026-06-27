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
