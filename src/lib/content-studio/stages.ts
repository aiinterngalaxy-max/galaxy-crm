// The fixed content-production pipeline. Order matters — index == progress.
// Matches the Galaxy Marketing Command Center spec.
export const STAGES = [
  "Idea",
  "Approved",
  "Script Writing",
  "Script Review",
  "Revisions",
  "Shoot Planning",
  "Shoot Scheduled",
  "Shooting",
  "Editing",
  "Review",
  "Ready To Publish",
  "Published",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s, i])
);

// Completion % derived purely from how far a piece has moved down the pipeline.
export function stageProgress(stage: string): number {
  const i = STAGE_INDEX[stage];
  if (i === undefined) return 0;
  return Math.round((i / (STAGES.length - 1)) * 100);
}

// A compact color identity per stage (Tailwind classes) — used by chips & the board.
export const STAGE_STYLE: Record<string, { dot: string; chip: string; col: string }> = {
  "Idea":              { dot: "bg-slate-400",   chip: "bg-slate-100 text-slate-700",     col: "border-slate-300" },
  "Approved":          { dot: "bg-cyan-500",     chip: "bg-cyan-100 text-cyan-700",       col: "border-cyan-300" },
  "Script Writing":    { dot: "bg-sky-500",      chip: "bg-sky-100 text-sky-700",         col: "border-sky-300" },
  "Script Review":     { dot: "bg-amber-500",    chip: "bg-amber-100 text-amber-700",     col: "border-amber-300" },
  "Revisions":         { dot: "bg-orange-500",   chip: "bg-orange-100 text-orange-700",   col: "border-orange-300" },
  "Shoot Planning":    { dot: "bg-violet-500",   chip: "bg-violet-100 text-violet-700",   col: "border-violet-300" },
  "Shoot Scheduled":   { dot: "bg-fuchsia-500",  chip: "bg-fuchsia-100 text-fuchsia-700", col: "border-fuchsia-300" },
  "Shooting":          { dot: "bg-rose-500",     chip: "bg-rose-100 text-rose-700",       col: "border-rose-300" },
  "Editing":           { dot: "bg-indigo-500",   chip: "bg-indigo-100 text-indigo-700",   col: "border-indigo-300" },
  "Review":            { dot: "bg-yellow-500",   chip: "bg-yellow-100 text-yellow-700",   col: "border-yellow-300" },
  "Ready To Publish":  { dot: "bg-teal-500",     chip: "bg-teal-100 text-teal-700",       col: "border-teal-300" },
  "Published":         { dot: "bg-emerald-600",  chip: "bg-emerald-100 text-emerald-700", col: "border-emerald-400" },
};

export const PLATFORMS = ["Instagram", "YouTube", "LinkedIn", "Facebook", "TikTok", "X"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_STYLE: Record<string, string> = {
  Instagram: "bg-pink-100 text-pink-700",
  YouTube:   "bg-red-100 text-red-700",
  LinkedIn:  "bg-blue-100 text-blue-700",
  Facebook:  "bg-indigo-100 text-indigo-700",
  TikTok:    "bg-slate-200 text-slate-800",
  X:         "bg-slate-200 text-slate-900",
};

export const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_STYLE: Record<string, string> = {
  Low: "bg-slate-100 text-slate-600",
  Normal: "bg-sky-100 text-sky-700",
  High: "bg-amber-100 text-amber-700",
  Urgent: "bg-rose-100 text-rose-700",
};
