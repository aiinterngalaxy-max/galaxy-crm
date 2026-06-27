import { STAGES } from "./stages";

// ---- date helpers (relative to "now" so the demo always looks current) ----
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export interface SeedBundle {
  brands: any[];
  channels: any[];
  team: any[];
  content: any[];
  scripts: any[];
  ideas: any[];
  shoots: any[];
  performance: any[];
}

// Galaxy's own marketing operation, modelled as internal brands/properties —
// each with its own monthly target, lead and pipeline. Dates are computed
// relative to today so the demo always looks live.
export function buildSeed(): SeedBundle {
  const brands = [
    { name: "Galaxy Home Automation",  category: "Flagship brand",     status: "Active",     monthly_target: 12, lead: "Krish Shah",   notes: "Core brand channel — installs, education, brand films." },
    { name: "Galaxy Luxury",           category: "Premium villas",     status: "Active",     monthly_target: 8,  lead: "Aanya Mehta",  notes: "High-end villa & penthouse automation showcases." },
    { name: "Galaxy Security",         category: "CCTV / access",      status: "Active",     monthly_target: 6,  lead: "Rohan Verma",  notes: "Surveillance, access control, myth-busting explainers." },
    { name: "Galaxy Retail",           category: "Showroom / B2B",     status: "Onboarding", monthly_target: 5,  lead: "Aanya Mehta",  notes: "Dealer/showroom content + B2B lead-gen on LinkedIn." },
    { name: "Krish Shah (Founder)",    category: "Thought leadership", status: "Active",     monthly_target: 6,  lead: "Krish Shah",   notes: "Founder personal brand — LinkedIn build-in-public." },
  ];

  // one channel per brand for its primary platform (illustrative handles)
  const channels = [
    { brand: 1, platform: "Instagram", handle: "@galaxyhomeautomation", follower_count: 48200 },
    { brand: 1, platform: "YouTube",   handle: "Galaxy Home Automation", follower_count: 19800 },
    { brand: 2, platform: "Instagram", handle: "@galaxy.luxury",        follower_count: 22100 },
    { brand: 3, platform: "LinkedIn",  handle: "Galaxy Security",       follower_count: 6400 },
    { brand: 3, platform: "Instagram", handle: "@galaxy.security",      follower_count: 9100 },
    { brand: 4, platform: "LinkedIn",  handle: "Galaxy Retail",         follower_count: 3100 },
    { brand: 5, platform: "LinkedIn",  handle: "Krish Shah",            follower_count: 27400 },
  ];

  const team = [
    { name: "Krish Shah",    role: "Strategist", capacity: 10, is_owner: 1 },
    { name: "Aanya Mehta",   role: "Lead",       capacity: 12, is_owner: 0 },
    { name: "Rohan Verma",   role: "Writer",     capacity: 8,  is_owner: 0 },
    { name: "Priya Nair",    role: "Writer",     capacity: 8,  is_owner: 0 },
    { name: "Vikram Shetty", role: "Editor",     capacity: 10, is_owner: 0 },
    { name: "Sana Kapoor",   role: "Editor",     capacity: 10, is_owner: 0 },
    { name: "Dev Patel",     role: "Shooter",    capacity: 6,  is_owner: 0 },
  ];

  // content[i] uses brand_id = (index into brands) + 1
  // Stages chosen to spread across the whole 12-stage pipeline; dates create
  // realistic overdue / upcoming / published states.
  const content = [
    { b: 1, title: "5 signs your villa needs automation", format: "Reel",      platform: "Instagram", stage: "Published",       priority: "Normal", writer: "Rohan Verma", editor: "Vikram Shetty", talent: "Krish Shah", start: -28, due: -18, pub: -12, shoot: -20, location: "Galaxy Studio, Andheri", rev: 1, appr: 1, notes: "Top performer this month." },
    { b: 1, title: "Pradhan Coorg estate — full walkthrough", format: "Long-form", platform: "YouTube", stage: "Editing",      priority: "High", writer: "Priya Nair", editor: "Sana Kapoor", talent: "Gokul", start: -16, due: 3, pub: null, shoot: -8, location: "Coorg site", rev: 1, appr: 0, notes: "Flagship case study. Drone footage in." },
    { b: 1, title: "One-tap movie night scene", format: "Short",     platform: "YouTube",  stage: "Ready To Publish", priority: "Normal", writer: "Rohan Verma", editor: "Vikram Shetty", talent: "Dev Patel", start: -10, due: 1, pub: null, shoot: -5, location: "Galaxy Studio, Andheri", rev: 0, appr: 1, notes: "Scheduled for tomorrow." },
    { b: 1, title: "How much does home automation really cost?", format: "Carousel", platform: "Instagram", stage: "Review", priority: "Normal", writer: "Priya Nair", editor: "", talent: "", start: -6, due: -1, pub: null, shoot: null, location: "", rev: 0, appr: 0, notes: "OVERDUE for review — chase." },
    { b: 1, title: "Smart lighting myths", format: "Reel", platform: "Instagram", stage: "Script Writing", priority: "Normal", writer: "Rohan Verma", editor: "", talent: "", start: -2, due: 4, pub: null, shoot: null, location: "", rev: 0, appr: 0, notes: "" },
    { b: 1, title: "Behind the scenes: install crew", format: "Reel", platform: "Instagram", stage: "Idea", priority: "Low", writer: "", editor: "", talent: "", start: null, due: 9, pub: null, shoot: null, location: "", rev: 0, appr: 0, notes: "" },

    { b: 2, title: "₹2Cr penthouse: every room automated", format: "Long-form", platform: "YouTube", stage: "Shooting", priority: "Urgent", writer: "Aanya Mehta", editor: "Sana Kapoor", talent: "Aanya Mehta", start: -14, due: 6, pub: null, shoot: 0, location: "Worli penthouse", rev: 0, appr: 1, notes: "Shoot today." },
    { b: 2, title: "Hidden tech, visible luxury", format: "Reel", platform: "Instagram", stage: "Shoot Scheduled", priority: "Normal", writer: "Priya Nair", editor: "", talent: "", start: -5, due: 8, pub: null, shoot: 4, location: "TBC — Juhu villa", rev: 0, appr: 1, notes: "" },
    { b: 2, title: "Automated wine cellar tour", format: "Short", platform: "Instagram", stage: "Revisions", priority: "High", writer: "Aanya Mehta", editor: "Vikram Shetty", talent: "", start: -12, due: -2, pub: null, shoot: -7, location: "Bandra villa", rev: 2, appr: 0, notes: "OVERDUE — needs re-edit." },
    { b: 2, title: "Mood scenes for the master suite", format: "Reel", platform: "Instagram", stage: "Published", priority: "Normal", writer: "Priya Nair", editor: "Sana Kapoor", talent: "", start: -30, due: -22, pub: -15, shoot: -25, location: "Powai villa", rev: 1, appr: 1, notes: "" },

    { b: 3, title: "CCTV myths debunked", format: "Carousel", platform: "LinkedIn", stage: "Published", priority: "Normal", writer: "Rohan Verma", editor: "Vikram Shetty", talent: "", start: -24, due: -16, pub: -10, shoot: null, location: "", rev: 0, appr: 1, notes: "Strong B2B saves." },
    { b: 3, title: "Face-recognition access in 60s", format: "Short", platform: "YouTube", stage: "Editing", priority: "Normal", writer: "Priya Nair", editor: "Sana Kapoor", talent: "Dev Patel", start: -9, due: 2, pub: null, shoot: -4, location: "Galaxy Studio, Andheri", rev: 1, appr: 0, notes: "" },
    { b: 3, title: "Is your home really secure?", format: "Reel", platform: "Instagram", stage: "Script Writing", priority: "Normal", writer: "Rohan Verma", editor: "", talent: "", start: -1, due: 5, pub: null, shoot: null, location: "", rev: 0, appr: 0, notes: "" },
    { b: 3, title: "Remote monitoring demo", format: "Short", platform: "Instagram", stage: "Idea", priority: "Low", writer: "", editor: "", talent: "", start: null, due: 11, pub: null, shoot: null, location: "", rev: 0, appr: 0, notes: "" },

    { b: 4, title: "Visit our Andheri experience center", format: "Reel", platform: "Instagram", stage: "Shoot Planning", priority: "Normal", writer: "Aanya Mehta", editor: "", talent: "", start: -4, due: 7, pub: null, shoot: 5, location: "Andheri showroom", rev: 0, appr: 1, notes: "" },
    { b: 4, title: "Why dealers choose Galaxy (B2B)", format: "Carousel", platform: "LinkedIn", stage: "Review", priority: "Normal", writer: "Rohan Verma", editor: "", talent: "", start: -7, due: 1, pub: null, shoot: null, location: "", rev: 0, appr: 0, notes: "" },
    { b: 4, title: "Showroom walkthrough", format: "Long-form", platform: "YouTube", stage: "Idea", priority: "Low", writer: "", editor: "", talent: "", start: null, due: 13, pub: null, shoot: null, location: "", rev: 0, appr: 0, notes: "" },

    { b: 5, title: "What I learned scaling to 250 homes", format: "Post", platform: "LinkedIn", stage: "Published", priority: "Normal", writer: "Krish Shah", editor: "", talent: "Krish Shah", start: -20, due: -14, pub: -8, shoot: null, location: "", rev: 0, appr: 1, notes: "Best founder post yet." },
    { b: 5, title: "Hiring: how we built the install crew", format: "Post", platform: "LinkedIn", stage: "Script Writing", priority: "Normal", writer: "Krish Shah", editor: "", talent: "Krish Shah", start: -2, due: 3, pub: null, shoot: null, location: "", rev: 0, appr: 0, notes: "" },
    { b: 5, title: "Founder vlog: a day on site", format: "Short", platform: "YouTube", stage: "Shoot Scheduled", priority: "Normal", writer: "Priya Nair", editor: "Vikram Shetty", talent: "Krish Shah", start: -3, due: 10, pub: null, shoot: 6, location: "Live site, Thane", rev: 0, appr: 1, notes: "" },
    { b: 5, title: "5 hard lessons on margins", format: "Carousel", platform: "LinkedIn", stage: "Ready To Publish", priority: "High", writer: "Krish Shah", editor: "Sana Kapoor", talent: "", start: -8, due: 0, pub: null, shoot: null, location: "", rev: 1, appr: 1, notes: "Publish today." },
  ];

  // ideas per brand for this month (target-driven; some pitched, some pending)
  const month = thisMonth();
  const ideas: any[] = [];
  brands.forEach((br, idx) => {
    const bid = idx + 1;
    const target = br.monthly_target;
    const pitchedCount = Math.max(2, Math.round(target * (0.4 + (idx % 3) * 0.15)));
    for (let i = 0; i < target; i++) {
      const pitched = i < pitchedCount ? 1 : 0;
      const approved = pitched && i % 3 === 0 ? 1 : 0;
      const rejected = pitched && !approved && i % 5 === 4 ? 1 : 0;
      ideas.push({
        brand_id: bid,
        month,
        title: `${br.name.split(" ")[1] ?? br.name} idea #${i + 1}`,
        pitched,
        pitch_due: addDays((i % 5) + 1),
        approved,
        rejected,
        review_note: rejected ? "Needs more detail before we can proceed." : "",
        content_id: null,
      });
    }
  });

  // shoots — some upcoming/scheduled, one done
  const shoots = [
    { brand_id: 2, title: "₹2Cr penthouse shoot", shoot: 0,  time: "10:00 AM", location: "Worli penthouse",       talent: "Aanya Mehta", team: "Aanya Mehta, Dev Patel", equipment: "Drone, gimbal, 2x camera", status: "Scheduled", notes: "Full crew, drone." },
    { brand_id: 4, title: "Andheri showroom b-roll", shoot: 5, time: "2:00 PM", location: "Andheri showroom",     talent: "Dev Patel",  team: "Dev Patel", equipment: "Camera, tripod", status: "Scheduled", notes: "" },
    { brand_id: 5, title: "Founder vlog on-site", shoot: 6,  time: "9:00 AM", location: "Live site, Thane",       talent: "Krish Shah", team: "Priya Nair, Dev Patel", equipment: "Camera, lav mic", status: "Planned",   notes: "Confirm site access." },
    { brand_id: 2, title: "Juhu villa reel", shoot: 4,        time: "TBC", location: "Juhu villa (TBC)",          talent: "",           team: "", equipment: "", status: "Planned",   notes: "Location not locked." },
    { brand_id: 1, title: "Movie-night scene reshoot", shoot: -5, time: "11:00 AM", location: "Galaxy Studio, Andheri", talent: "Dev Patel", team: "Dev Patel", equipment: "Camera, gimbal", status: "Completed",  notes: "Footage delivered to edit." },
    { brand_id: 3, title: "Access-control demo", shoot: -4,   time: "3:00 PM", location: "Galaxy Studio, Andheri", talent: "Dev Patel", team: "Dev Patel", equipment: "Camera", status: "Completed",      notes: "" },
  ];

  // performance rows for the published pieces (content indices that are 'Published')
  const performance: any[] = [];
  content.forEach((row, idx) => {
    if (row.stage === "Published") {
      const cid = idx + 1; // content id == insertion order
      const base = 8000 + (idx * 4200) % 60000;
      performance.push({
        content_id: cid,
        views: base,
        reach: Math.round(base * 0.78),
        likes: Math.round(base * 0.06),
        comments: Math.round(base * 0.008),
        shares: Math.round(base * 0.012),
        saves: Math.round(base * 0.02),
        watch_time_sec: Math.round(base * 11),
        clicks: Math.round(base * 0.015),
        follower_growth: Math.round(base * 0.004),
      });
    }
  });

  // a script row for every piece that has reached script writing or beyond
  const SCRIPT_FROM = STAGES.indexOf("Script Writing");
  const scripts: any[] = [];
  content.forEach((row, idx) => {
    const stageIdx = STAGES.indexOf(row.stage as any);
    if (stageIdx < SCRIPT_FROM || !row.writer) return;
    const cid = idx + 1;
    const pastReview = stageIdx > STAGES.indexOf("Script Review");
    scripts.push({
      content_id: cid,
      writer: row.writer,
      status: row.stage === "Script Writing" ? "In Progress" : pastReview ? "Approved" : "Submitted",
      deadline: row.due === null ? null : addDays(row.due - 2 < -60 ? row.due : row.due),
      revision_count: row.rev,
      review_comments: row.stage === "Revisions" ? "Needs another pass — see notes." : "",
      approved: pastReview ? 1 : 0,
      approved_at: pastReview && row.due !== null ? addDays(row.due - 1) : null,
    });
  });

  // materialise content with real dates
  const contentRows = content.map((r) => ({
    brand_id: r.b,
    title: r.title,
    format: r.format,
    platform: r.platform,
    stage: r.stage,
    priority: r.priority,
    writer: r.writer,
    editor: r.editor,
    talent: r.talent,
    start_date: r.start === null ? null : addDays(r.start),
    due_date: r.due === null ? null : addDays(r.due),
    publish_date: r.pub === null ? null : addDays(r.pub),
    shoot_date: r.shoot === null ? null : addDays(r.shoot),
    location: r.location,
    revision_rounds: r.rev,
    approved: r.appr,
    notes: r.notes,
  }));

  const shootRows = shoots.map((s) => ({
    brand_id: s.brand_id,
    content_id: null,
    title: s.title,
    shoot_date: addDays(s.shoot),
    shoot_time: s.time,
    location: s.location,
    talent: s.talent,
    team: s.team,
    equipment: s.equipment,
    status: s.status,
    notes: s.notes,
  }));

  return { brands, channels, team, content: contentRows, scripts, ideas, shoots: shootRows, performance };
}

// sanity: every content row's stage is valid
export function validateSeed(b: SeedBundle): string[] {
  const errs: string[] = [];
  const stageSet = new Set<string>(STAGES as readonly string[]);
  b.content.forEach((c, i) => {
    if (!stageSet.has(c.stage)) errs.push(`content[${i}] bad stage: ${c.stage}`);
  });
  return errs;
}
