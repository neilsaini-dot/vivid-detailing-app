export const HALIFAX_TZ = "America/Halifax";

function parts(ms: number, opts: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: HALIFAX_TZ, hourCycle: "h23", ...opts })
    .formatToParts(new Date(ms))
    .forEach((p) => { out[p.type] = p.value; });
  return out;
}

/** Offset (minutes, Halifax minus UTC) at the given instant. */
function offsetAt(ms: number): number {
  const p = parts(ms, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Today's calendar date (YYYY-MM-DD) in Halifax, independent of device timezone. */
export function halifaxToday(): string {
  const p = parts(Date.now(), { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Interpret a Halifax wall-clock date (YYYY-MM-DD) and time (HH:mm) as an ISO string with the real Halifax offset. */
export function halifaxWallToIso(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  let off = offsetAt(wall);
  off = offsetAt(wall - off * 60000);
  const sign = off <= 0 ? "-" : "+";
  const abs = Math.abs(off);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${date}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00${sign}${oh}:${om}`;
}

/** Extract Halifax wall-clock HH:mm from a slot value that is either "HH:mm" or an ISO timestamp. */
export function slotWallTime(start: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(start.trim());
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const ms = Date.parse(start);
  if (Number.isNaN(ms)) return start;
  const p = parts(ms, { hour: "2-digit", minute: "2-digit" });
  return `${p.hour}:${p.minute}`;
}

export function slotWallDate(date: string, start: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const ms = Date.parse(start);
  const p = parts(Number.isNaN(ms) ? Date.now() : ms, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Format an instant for display in Halifax time. */
export function formatHalifax(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HALIFAX_TZ, weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(ms));
}

/** Format a Halifax wall-clock date string for display without device-timezone drift. */
export function formatWallDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}
