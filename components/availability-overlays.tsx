import type { EventInput } from "@fullcalendar/core";

export type AvailabilitySlotView = {
  id: string;
  start: string;
  end: string;
  availabilityType: "AVAILABLE" | "UNAVAILABLE";
};

const calendarStartHour = 6;
const calendarEndHour = 22;

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isMidnight(date: Date) {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function lastOverlappedDay(end: Date) {
  return startOfDay(isMidnight(end) ? addDays(end, -1) : end);
}

function dateAtHour(date: Date, hour: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
}

function clampInterval(start: Date, end: Date, min: Date, max: Date) {
  const clampedStart = start > min ? start : min;
  const clampedEnd = end < max ? end : max;

  return clampedEnd > clampedStart ? { start: clampedStart, end: clampedEnd } : null;
}

export function availabilityBackgroundEvents(slots: AvailabilitySlotView[]) {
  if (slots.length === 0) {
    return [] satisfies EventInput[];
  }

  const parsedSlots = slots.map((slot) => ({
    ...slot,
    startDate: new Date(slot.start),
    endDate: new Date(slot.end),
  }));
  const minDay = startOfDay(
    parsedSlots.reduce((min, slot) => (slot.startDate < min ? slot.startDate : min), parsedSlots[0].startDate),
  );
  const maxDay = startOfDay(
    parsedSlots.reduce((max, slot) => {
      const slotEndDay = lastOverlappedDay(slot.endDate);
      return slotEndDay > max ? slotEndDay : max;
    }, lastOverlappedDay(parsedSlots[0].endDate)),
  );
  const slotsByDay = new Map<string, typeof parsedSlots>();
  const events: EventInput[] = [];

  for (const slot of parsedSlots) {
    for (
      let day = startOfDay(slot.startDate);
      day <= lastOverlappedDay(slot.endDate);
      day = addDays(day, 1)
    ) {
      const key = dayKey(day);
      slotsByDay.set(key, [...(slotsByDay.get(key) ?? []), slot]);
    }
  }

  for (let day = minDay, index = 0; day <= maxDay; day = addDays(day, 1), index += 1) {
    const key = dayKey(day);
    const dayStart = dateAtHour(day, calendarStartHour);
    const dayEnd = dateAtHour(day, calendarEndHour);
    const daySlots = slotsByDay.get(key) ?? [];
    const availableIntervals = daySlots
      .filter((slot) => slot.availabilityType === "AVAILABLE")
      .map((slot) => clampInterval(slot.startDate, slot.endDate, dayStart, dayEnd))
      .filter((interval): interval is { start: Date; end: Date } => Boolean(interval))
      .sort((left, right) => left.start.getTime() - right.start.getTime());

    let cursor = dayStart;

    for (const interval of availableIntervals) {
      if (interval.start > cursor) {
        events.push({
          id: `blocked-bg-${key}-${index}-${cursor.toISOString()}`,
          start: cursor.toISOString(),
          end: interval.start.toISOString(),
          display: "background",
          classNames: ["availability-blocked-background"],
          extendedProps: { unavailableSlot: true },
        });
      }

      if (interval.end > cursor) {
        cursor = interval.end;
      }
    }

    if (cursor < dayEnd) {
      events.push({
        id: `blocked-bg-${key}-${index}-end`,
        start: cursor.toISOString(),
        end: dayEnd.toISOString(),
        display: "background",
        classNames: ["availability-blocked-background"],
        extendedProps: { unavailableSlot: true },
      });
    }

    for (const slot of daySlots.filter((item) => item.availabilityType === "UNAVAILABLE")) {
      const interval = clampInterval(slot.startDate, slot.endDate, dayStart, dayEnd);

      if (interval) {
        events.push({
          id: `unavailable-bg-${slot.id}`,
          start: interval.start.toISOString(),
          end: interval.end.toISOString(),
          display: "background",
          classNames: ["availability-blocked-background"],
          extendedProps: { unavailableSlot: true },
        });
      }
    }
  }

  return events;
}
