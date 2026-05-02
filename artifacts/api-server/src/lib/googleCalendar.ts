import { ReplitConnectors } from "@replit/connectors-sdk";

const CALENDAR_ID = "primary";
const SHOP_OPEN_HOUR = 8;
const SHOP_CLOSE_HOUR = 18;

export interface TimeSlot {
  start: string;
  end: string;
  label: string;
  available: boolean;
}

export async function getAvailableSlots(
  date: string,
  durationHours: number
): Promise<TimeSlot[]> {
  const connectors = new ReplitConnectors();

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  const freebusyResponse = await connectors.proxy(
    "google-calendar",
    "/freeBusy",
    {
      method: "POST",
      body: JSON.stringify({
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        items: [{ id: CALENDAR_ID }],
      }),
    }
  );

  let busyPeriods: { start: string; end: string }[] = [];
  try {
    const data = await freebusyResponse.json() as any;
    busyPeriods = data?.calendars?.[CALENDAR_ID]?.busy ?? [];
  } catch {
    busyPeriods = [];
  }

  const slots: TimeSlot[] = [];
  const durationMs = durationHours * 60 * 60 * 1000;

  for (let hour = SHOP_OPEN_HOUR; hour + durationHours <= SHOP_CLOSE_HOUR; hour++) {
    const slotStart = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMs);

    const isBusy = busyPeriods.some(busy => {
      const busyStart = new Date(busy.start).getTime();
      const busyEnd = new Date(busy.end).getTime();
      const slotStartMs = slotStart.getTime();
      const slotEndMs = slotEnd.getTime();
      return slotStartMs < busyEnd && slotEndMs > busyStart;
    });

    const hh = String(hour).padStart(2, "0");
    const endHH = String(Math.floor(hour + durationHours)).padStart(2, "0");
    const endMM = String(Math.round((durationHours % 1) * 60)).padStart(2, "0");

    slots.push({
      start: `${hh}:00`,
      end: `${endHH}:${endMM}`,
      label: `${hh}:00`,
      available: !isBusy,
    });
  }

  return slots;
}
