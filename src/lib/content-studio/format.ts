// Small presentation helpers shared across pages.

export function compact(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 100_000 ? 0 : 1) + "k";
  return String(n);
}

export function num(n: number): string {
  return (n ?? 0).toLocaleString("en-IN");
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

// "12 Jun", "12 Jun 2026"
export function fmtDate(d: string | null, withYear = false): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? d + "T00:00:00" : d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

// Relative-days phrasing for deadlines.
export function dueLabel(days: number | null): { text: string; tone: "ok" | "warn" | "bad" | "mute" } {
  if (days === null) return { text: "no date", tone: "mute" };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "bad" };
  if (days === 0) return { text: "due today", tone: "warn" };
  if (days <= 2) return { text: `${days}d left`, tone: "warn" };
  return { text: `${days}d left`, tone: "ok" };
}

export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
