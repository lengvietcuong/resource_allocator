import { and, asc, desc, eq, gt, inArray, lt, ne, or } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  actionPlans,
  activities,
  activityEquipment,
  activityStaff,
  activitySubstitutions,
  availabilitySlots,
  calendarEvents,
  equipment,
  preparationTasks,
  scheduleDependencies,
  schedules,
  unscheduledActivities,
  users,
  type Activity,
  type AvailabilitySlot,
  type CalendarEvent,
  type User,
} from "@/lib/db/schema";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const SLOT_STEP_MINUTES = 15;
const appTimeZone = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Ho_Chi_Minh";

type ResourceLinks = {
  staffIds: string[];
  equipmentIds: string[];
  preparationMinutes: number;
};

type ActivityWithResources = Activity & ResourceLinks;

type ScheduledDraft = {
  activityId: string | null;
  title: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  scheduleMode: ScheduleMode;
  isManual: boolean;
  blocksScheduling: boolean;
  notes: string;
  staffIds: string[];
  equipmentIds: string[];
};

type UnscheduledDraft = {
  activityId: string;
  title: string;
  missedCount: number;
  failedWindows: MissedWindow[];
  reason: string;
};

type MissedWindow = {
  windowStart: Date;
  windowEnd: Date;
};

type OccupiedSlot = {
  start: Date;
  end: Date;
  blocksInPerson: boolean;
  blocksRemote: boolean;
};

type ScoredCandidate = {
  start: Date;
  score: number;
};

type CandidateStart = {
  start: Date;
  isPreferred: boolean;
};

type OccurrenceTarget = {
  target: Date;
  windowStart: Date;
  windowEnd: Date;
};

type ResourceOccupiedMap = Map<string, OccupiedSlot[]>;
type ActivityOccupiedMap = Map<string, OccupiedSlot[]>;

type ResourceAvailability = {
  available: AvailabilitySlot[];
  unavailable: AvailabilitySlot[];
};

type ResourceAvailabilityMap = Map<string, ResourceAvailability>;
type ScheduleMode = "SELF_GUIDED" | "REMOTE" | "IN_PERSON";
type UserCapability = Pick<User, "supportsRemote" | "supportsInPerson">;
type UserCapabilityMap = Map<string, UserCapability>;

export type ScheduleGenerationResult = {
  scheduleId: string;
  version: number;
  scheduledCount: number;
  unresolvedCount: number;
  warnings: string[];
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * MINUTE);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY);
}

function appDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => {
    const part = parts.find((item) => item.type === type)?.value;

    if (!part) {
      throw new Error("Unable to resolve schedule date.");
    }

    return Number(part);
  };

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function appTimeZoneOffset(date: Date) {
  const parts = appDateParts(date);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

function appLocalDateTime(year: number, month: number, day: number, hour = 0, minute = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(guess.getTime() - appTimeZoneOffset(guess));
  const second = new Date(guess.getTime() - appTimeZoneOffset(first));

  return second;
}

function startOfDay(date: Date) {
  const parts = appDateParts(date);

  return appLocalDateTime(parts.year, parts.month, parts.day);
}

function endOfDay(date: Date) {
  return addDays(startOfDay(date), 1);
}

function dateAt(date: Date, hour: number, minute = 0) {
  const parts = appDateParts(date);

  return appLocalDateTime(parts.year, parts.month, parts.day, hour, minute);
}

const failedWindowFormatter = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: appTimeZone,
});

function failedWindowLabel(window: MissedWindow) {
  const displayEnd = window.windowEnd > window.windowStart
    ? new Date(window.windowEnd.getTime() - 1)
    : window.windowEnd;

  return `From ${failedWindowFormatter.format(window.windowStart)} to ${failedWindowFormatter.format(displayEnd)}`;
}

function windowKey(window: MissedWindow) {
  return `${window.windowStart.getTime()}-${window.windowEnd.getTime()}`;
}

function missedReason(failedWindows: MissedWindow[], reasons: string[]) {
  const sections: string[] = [];

  if (reasons.length > 0) {
    sections.push(
      "Why scheduling failed:",
      ...reasons.map((reason) => `- ${reason}`),
      "",
    );
  }

  sections.push(
    "Missed scheduling windows:",
    ...Array.from(new Map(failedWindows.map((window) => [windowKey(window), window])).values())
      .map((window) => `- ${failedWindowLabel(window)}`),
  );

  return sections.join("\n");
}

function startOfWeek(date: Date) {
  const parts = appDateParts(date);
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;

  return startOfDay(addDays(date, diff));
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function contains(containerStart: Date, containerEnd: Date, start: Date, end: Date) {
  return containerStart <= start && containerEnd >= end;
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function getAvailability(
  map: ResourceAvailabilityMap,
  resourceId: string,
): ResourceAvailability {
  return map.get(resourceId) ?? { available: [], unavailable: [] };
}

function isResourceAvailable(
  availability: ResourceAvailability,
  start: Date,
  end: Date,
) {
  const blocked = availability.unavailable.some((slot) =>
    overlaps(start, end, slot.startsAt, slot.endsAt),
  );

  if (blocked) {
    return false;
  }

  return mergedAvailableIntervals(availability.available).some((slot) =>
    contains(slot.start, slot.end, start, end),
  );
}

function availabilityFailureReason(
  availability: ResourceAvailability,
  start: Date,
  end: Date,
  blockedReason: string,
  unavailableReason: string,
) {
  const blocked = availability.unavailable.some((slot) =>
    overlaps(start, end, slot.startsAt, slot.endsAt),
  );

  if (blocked) {
    return blockedReason;
  }

  const hasAvailableWindow = mergedAvailableIntervals(availability.available).some((slot) =>
    contains(slot.start, slot.end, start, end),
  );

  return hasAvailableWindow ? null : unavailableReason;
}

function candidateAvailabilityReason({
  availability,
  start,
  end,
  timeOffReason,
  unavailableReason,
}: {
  availability: ResourceAvailability;
  start: Date;
  end: Date;
  timeOffReason: string;
  unavailableReason: string;
}) {
  if (availability.unavailable.some((slot) => overlaps(start, end, slot.startsAt, slot.endsAt))) {
    return timeOffReason;
  }

  return isResourceAvailable(availability, start, end) ? null : unavailableReason;
}

function candidateFailureReasons({
  activity,
  start,
  scheduleMode,
  occurrence,
  clientId,
  occupied,
  activityOccupied,
  resourceOccupied,
  userAvailability,
  equipmentAvailability,
  userCapabilities,
}: {
  activity: ActivityWithResources;
  start: Date;
  scheduleMode: ScheduleMode;
  occurrence: MissedWindow;
  clientId: string;
  occupied: OccupiedSlot[];
  activityOccupied: ActivityOccupiedMap;
  resourceOccupied: ResourceOccupiedMap;
  userAvailability: ResourceAvailabilityMap;
  equipmentAvailability: ResourceAvailabilityMap;
  userCapabilities: UserCapabilityMap;
}): Set<string> {
  const reasons = new Set<string>();
  const end = addMinutes(start, activity.durationMinutes);
  const prepStart = addMinutes(start, -activity.preparationMinutes);

  if (end > occurrence.windowEnd || prepStart < occurrence.windowStart) {
    reasons.add("Activity duration or preparation time does not fit inside the scheduling window.");
  }

  if (tooCloseToSameActivity(activityOccupied, activity, start, end)) {
    reasons.add("Another occurrence of the same activity is too close to this window.");
  }

  if (
    occupied.some(
      (slot) =>
        occupiedBlocksMode(slot, scheduleMode) && overlaps(start, end, slot.start, slot.end),
    )
  ) {
    reasons.add("Client bookings leave no open time for the required duration.");
  }

  const clientAvailability = getAvailability(userAvailability, clientId);
  const clientReason = candidateAvailabilityReason({
    availability: clientAvailability,
    start,
    end,
    timeOffReason: "Client has time off during the scheduling window.",
    unavailableReason: "Client has no matching available time for the required duration.",
  });

  if (clientReason) {
    reasons.add(clientReason);
  }

  if (activity.preparationMinutes > 0) {
    if (
      occupied.some(
        (slot) => slot.blocksInPerson && overlaps(prepStart, start, slot.start, slot.end),
      )
    ) {
      reasons.add("Preparation time overlaps another client event.");
    }

    const prepReason = candidateAvailabilityReason({
      availability: clientAvailability,
      start: prepStart,
      end: start,
      timeOffReason: "Preparation time overlaps client time off.",
      unavailableReason: "Client does not have an available preparation window before the activity.",
    });

    if (prepReason) {
      reasons.add(prepReason);
    }
  }

  for (const staffId of activity.staffIds) {
    const capability = userCapabilities.get(staffId);

    if (scheduleMode === "REMOTE" && capability?.supportsRemote !== true) {
      reasons.add("Required staff does not support remote sessions.");
    }

    if (scheduleMode === "IN_PERSON" && capability?.supportsInPerson === false) {
      reasons.add("Required staff does not support in-person sessions.");
    }

    if (resourceIsOccupied(resourceOccupied, staffId, start, end)) {
      reasons.add("Required staff bookings leave no open time.");
    }

    const staffReason = candidateAvailabilityReason({
      availability: getAvailability(userAvailability, staffId),
      start,
      end,
      timeOffReason: "Required staff has time off during the scheduling window.",
      unavailableReason: "Required staff has no matching available time.",
    });

    if (staffReason) {
      reasons.add(staffReason);
    }
  }

  for (const equipmentId of activity.equipmentIds) {
    if (resourceIsOccupied(resourceOccupied, equipmentId, start, end)) {
      reasons.add("Required equipment bookings leave no open time.");
    }

    const equipmentReason = candidateAvailabilityReason({
      availability: getAvailability(equipmentAvailability, equipmentId),
      start,
      end,
      timeOffReason: "Required equipment has time off during the scheduling window.",
      unavailableReason: "Required equipment has no matching available time.",
    });

    if (equipmentReason) {
      reasons.add(equipmentReason);
    }
  }

  return reasons;
}

function diagnoseMissedActivity({
  activity,
  failedWindows,
  clientId,
  occupied,
  activityOccupied,
  resourceOccupied,
  userAvailability,
  equipmentAvailability,
  userCapabilities,
}: {
  activity: ActivityWithResources;
  failedWindows: MissedWindow[];
  clientId: string;
  occupied: OccupiedSlot[];
  activityOccupied: ActivityOccupiedMap;
  resourceOccupied: ResourceOccupiedMap;
  userAvailability: ResourceAvailabilityMap;
  equipmentAvailability: ResourceAvailabilityMap;
  userCapabilities: UserCapabilityMap;
}) {
  const reasons = new Set<string>();
  const modes = possibleModes(activity);

  if (modes.length === 0) {
    reasons.add("Activity requirements do not match any supported scheduling mode.");
  }

  for (const window of failedWindows) {
    let dealBreakers: Set<string> | null = null;
    let hasPotentialPlacement = false;
    const candidates = buildCandidateStarts({
      target: new Date((window.windowStart.getTime() + window.windowEnd.getTime()) / 2),
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
    }, activity);

    for (const candidate of candidates) {
      for (const scheduleMode of modes) {
        const candidateReasons = candidateFailureReasons({
          activity,
          start: candidate.start,
          scheduleMode,
          occurrence: window,
          clientId,
          occupied,
          activityOccupied,
          resourceOccupied,
          userAvailability,
          equipmentAvailability,
          userCapabilities,
        });

        if (candidateReasons.size === 0) {
          hasPotentialPlacement = true;
          dealBreakers = new Set<string>();
          break;
        }

        if (dealBreakers) {
          const intersection = new Set<string>();

          for (const reason of dealBreakers) {
            if (candidateReasons.has(reason)) {
              intersection.add(reason);
            }
          }

          dealBreakers = intersection;
        } else {
          dealBreakers = candidateReasons;
        }
      }

      if (dealBreakers?.size === 0) {
        break;
      }
    }

    if (!dealBreakers && candidates.length === 0) {
      dealBreakers = new Set(["No candidate start times exist in the scheduling window."]);
    }

    if (!hasPotentialPlacement && dealBreakers?.size === 0) {
      reasons.add("No overlapping open slot exists for the client and required resources.");
    }

    for (const reason of dealBreakers ?? []) {
      reasons.add(reason);
    }
  }

  return [...reasons].sort();
}

function mergedAvailableIntervals(slots: AvailabilitySlot[]) {
  const sorted = slots
    .map((slot) => ({ start: slot.startsAt, end: slot.endsAt }))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const merged: { start: Date; end: Date }[] = [];

  for (const slot of sorted) {
    const previous = merged.at(-1);

    if (previous && slot.start <= previous.end) {
      if (slot.end > previous.end) {
        previous.end = slot.end;
      }
    } else {
      merged.push({ ...slot });
    }
  }

  return merged;
}

function occupiedSlotForEvent(event: Pick<CalendarEvent, "allDay" | "blocksScheduling" | "startTime" | "endTime">): OccupiedSlot {
  if (!event.blocksScheduling) {
    return {
      start: event.startTime,
      end: event.endTime,
      blocksInPerson: false,
      blocksRemote: false,
    };
  }

  if (!event.allDay) {
    return {
      start: event.startTime,
      end: event.endTime,
      blocksInPerson: true,
      blocksRemote: true,
    };
  }

  return {
    start: event.startTime,
    end: event.endTime,
    blocksInPerson: true,
    blocksRemote: true,
  };
}

function occupiedBlocksMode(slot: OccupiedSlot, mode: ScheduleMode) {
  return mode === "REMOTE" ? slot.blocksRemote : slot.blocksInPerson;
}

function possibleModes(activity: ActivityWithResources): ScheduleMode[] {
  if (activity.allDay) {
    return activity.staffIds.length === 0 && activity.equipmentIds.length === 0
      ? ["SELF_GUIDED"]
      : [];
  }

  if (activity.equipmentIds.length > 0) {
    return activity.supportsInPerson === false ? [] : ["IN_PERSON"];
  }

  if (activity.staffIds.length === 0) {
    return ["SELF_GUIDED"];
  }

  const modes: ScheduleMode[] = [];

  if (activity.supportsRemote === true) {
    modes.push("REMOTE");
  }

  if (activity.supportsInPerson !== false) {
    modes.push("IN_PERSON");
  }

  return modes;
}

function resourceIsOccupied(
  resourceOccupied: ResourceOccupiedMap,
  resourceId: string,
  start: Date,
  end: Date,
) {
  return (resourceOccupied.get(resourceId) ?? []).some((slot) =>
    overlaps(start, end, slot.start, slot.end),
  );
}

function minutesBetween(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) / MINUTE;
}

function nearestGapScore(start: Date, end: Date, occupied: OccupiedSlot[]) {
  let nearestBefore = Number.POSITIVE_INFINITY;
  let nearestAfter = Number.POSITIVE_INFINITY;

  for (const slot of occupied) {
    if (slot.end <= start) {
      nearestBefore = Math.min(nearestBefore, minutesBetween(slot.end, start));
    }

    if (slot.start >= end) {
      nearestAfter = Math.min(nearestAfter, minutesBetween(end, slot.start));
    }
  }

  const beforeScore = Number.isFinite(nearestBefore) ? Math.min(nearestBefore, 90) : 90;
  const afterScore = Number.isFinite(nearestAfter) ? Math.min(nearestAfter, 90) : 90;

  return beforeScore + afterScore;
}

function addResourceOccupation(
  resourceOccupied: ResourceOccupiedMap,
  resourceId: string,
  slot: OccupiedSlot,
) {
  resourceOccupied.set(resourceId, [...(resourceOccupied.get(resourceId) ?? []), slot]);
}

function activitySpacingMinutes(activity: Activity) {
  if (activity.frequencyValue <= 1) {
    return 0;
  }

  if (activity.frequencyUnit === "DAY") {
    return Math.floor(((24 * 60) / activity.frequencyValue) * 0.5);
  }

  if (activity.frequencyUnit === "WEEK") {
    return Math.floor(((7 * 24 * 60) / activity.frequencyValue) * 0.5);
  }

  if (activity.frequencyUnit === "MONTH") {
    return Math.floor(((28 * 24 * 60) / activity.frequencyValue) * 0.5);
  }

  return Math.floor(((365 * 24 * 60) / activity.frequencyValue) * 0.5);
}

function tooCloseToSameActivity(
  activityOccupied: ActivityOccupiedMap,
  activity: Activity,
  start: Date,
  end: Date,
) {
  const spacingMinutes = activitySpacingMinutes(activity);

  if (spacingMinutes <= 0) {
    return false;
  }

  return (activityOccupied.get(activity.id) ?? []).some((slot) =>
    start < addMinutes(slot.end, spacingMinutes) && end > addMinutes(slot.start, -spacingMinutes),
  );
}

function prepIsFeasible({
  prepStart,
  prepEnd,
  clientId,
  occupied,
  userAvailability,
}: {
  prepStart: Date;
  prepEnd: Date;
  clientId: string;
  occupied: OccupiedSlot[];
  userAvailability: ResourceAvailabilityMap;
}) {
  if (
    occupied.some(
      (slot) => slot.blocksInPerson && overlaps(prepStart, prepEnd, slot.start, slot.end),
    )
  ) {
    return false;
  }

  return isResourceAvailable(getAvailability(userAvailability, clientId), prepStart, prepEnd);
}

function prepFeasibilityReasons({
  prepStart,
  prepEnd,
  clientId,
  occupied,
  userAvailability,
}: {
  prepStart: Date;
  prepEnd: Date;
  clientId: string;
  occupied: OccupiedSlot[];
  userAvailability: ResourceAvailabilityMap;
}) {
  const reasons = new Set<string>();

  if (
    occupied.some(
      (slot) => slot.blocksInPerson && overlaps(prepStart, prepEnd, slot.start, slot.end),
    )
  ) {
    reasons.add("Preparation time overlaps another client event.");
  }

  const availabilityReason = availabilityFailureReason(
    getAvailability(userAvailability, clientId),
    prepStart,
    prepEnd,
    "Preparation time overlaps client time off.",
    "Client does not have an available preparation window before the activity.",
  );

  if (availabilityReason) {
    reasons.add(availabilityReason);
  }

  return [...reasons];
}

function feasibilityReasons({
  start,
  end,
  activity,
  clientId,
  occupied,
  resourceOccupied,
  userAvailability,
  equipmentAvailability,
  userCapabilities,
  scheduleMode,
}: {
  start: Date;
  end: Date;
  activity: ActivityWithResources;
  clientId: string;
  occupied: OccupiedSlot[];
  resourceOccupied: ResourceOccupiedMap;
  userAvailability: ResourceAvailabilityMap;
  equipmentAvailability: ResourceAvailabilityMap;
  userCapabilities: UserCapabilityMap;
  scheduleMode: ScheduleMode;
}) {
  const reasons = new Set<string>();

  if (
    occupied.some(
      (slot) =>
        occupiedBlocksMode(slot, scheduleMode) && overlaps(start, end, slot.start, slot.end),
    )
  ) {
    reasons.add("Client already has another event during the available window.");
  }

  const requiredUsers = [clientId, ...activity.staffIds];

  for (const userId of requiredUsers) {
    if (userId !== clientId && resourceIsOccupied(resourceOccupied, userId, start, end)) {
      reasons.add("Required staff is already booked during the available window.");
    }

    if (userId !== clientId) {
      const capability = userCapabilities.get(userId);

      if (scheduleMode === "REMOTE" && capability?.supportsRemote !== true) {
        reasons.add("Required staff does not support remote sessions.");
      }

      if (scheduleMode === "IN_PERSON" && capability?.supportsInPerson === false) {
        reasons.add("Required staff does not support in-person sessions.");
      }
    }

    const availabilityReason = availabilityFailureReason(
      getAvailability(userAvailability, userId),
      start,
      end,
      userId === clientId ? "Client has time off during the available window." : "Required staff has time off during the available window.",
      userId === clientId ? "Client has no matching available time." : "Required staff has no matching available time.",
    );

    if (availabilityReason) {
      reasons.add(availabilityReason);
    }
  }

  for (const equipmentId of activity.equipmentIds) {
    if (resourceIsOccupied(resourceOccupied, equipmentId, start, end)) {
      reasons.add("Required equipment is already booked during the available window.");
    }

    const availabilityReason = availabilityFailureReason(
      getAvailability(equipmentAvailability, equipmentId),
      start,
      end,
      "Required equipment has time off during the available window.",
      "Required equipment has no matching available time.",
    );

    if (availabilityReason) {
      reasons.add(availabilityReason);
    }
  }

  return [...reasons];
}

function isFeasible({
  start,
  end,
  activity,
  clientId,
  occupied,
  resourceOccupied,
  userAvailability,
  equipmentAvailability,
  userCapabilities,
  scheduleMode,
}: Parameters<typeof feasibilityReasons>[0]) {
  if (
    occupied.some(
      (slot) =>
        occupiedBlocksMode(slot, scheduleMode) && overlaps(start, end, slot.start, slot.end),
    )
  ) {
    return false;
  }

  const requiredUsers = [clientId, ...activity.staffIds];

  for (const userId of requiredUsers) {
    if (userId !== clientId && resourceIsOccupied(resourceOccupied, userId, start, end)) {
      return false;
    }

    if (userId !== clientId) {
      const capability = userCapabilities.get(userId);

      if (scheduleMode === "REMOTE" && capability?.supportsRemote !== true) {
        return false;
      }

      if (scheduleMode === "IN_PERSON" && capability?.supportsInPerson === false) {
        return false;
      }
    }

    if (!isResourceAvailable(getAvailability(userAvailability, userId), start, end)) {
      return false;
    }
  }

  for (const equipmentId of activity.equipmentIds) {
    if (resourceIsOccupied(resourceOccupied, equipmentId, start, end)) {
      return false;
    }

    if (
      !isResourceAvailable(getAvailability(equipmentAvailability, equipmentId), start, end)
    ) {
      return false;
    }
  }

  return true;
}

function addReasons(target: Set<string>, reasons: string[]) {
  for (const reason of reasons) {
    target.add(reason);
  }
}

function preferredHours(activity: Activity) {
  if (activity.activityType === "FITNESS") {
    return [7, 8, 17, 18, 12, 15, 10];
  }

  if (activity.activityType === "FOOD" || activity.activityType === "MEDICATION") {
    return [8, 13, 19, 7, 12, 18];
  }

  if (activity.activityType === "THERAPY") {
    return [12, 13, 17, 18, 11, 14, 16, 9];
  }

  return [12, 13, 10, 11, 14, 15, 9, 16];
}

function occurrenceTargets(activity: Activity, start: Date, horizonEnd: Date): OccurrenceTarget[] {
  const targets: OccurrenceTarget[] = [];

  if (activity.frequencyUnit === "DAY") {
    for (let day = startOfDay(start); day < horizonEnd; day = addDays(day, 1)) {
      for (let count = 0; count < activity.frequencyValue; count += 1) {
        const hour = preferredHours(activity)[count % preferredHours(activity).length];
        targets.push({
          target: dateAt(day, hour),
          windowStart: day < start ? start : day,
          windowEnd: endOfDay(day) > horizonEnd ? horizonEnd : endOfDay(day),
        });
      }
    }

    return targets;
  }

  if (activity.frequencyUnit === "WEEK") {
    for (let week = startOfWeek(start); week < horizonEnd; week = addDays(week, 7)) {
      const windowStart = week < start ? start : week;
      const windowEnd = addDays(week, 7) > horizonEnd ? horizonEnd : addDays(week, 7);

      for (const target of spacedPeriodTargets(windowStart, windowEnd, activity.frequencyValue, activity)) {
        targets.push({ target, windowStart, windowEnd });
      }
    }

    return targets;
  }

  if (activity.frequencyUnit === "MONTH") {
    const startParts = appDateParts(start);

    for (
      let cursor = appLocalDateTime(startParts.year, startParts.month, 1);
      cursor < horizonEnd;
      cursor = (() => {
        const parts = appDateParts(cursor);

        return appLocalDateTime(
          parts.month === 12 ? parts.year + 1 : parts.year,
          parts.month === 12 ? 1 : parts.month + 1,
          1,
        );
      })()
    ) {
      const cursorParts = appDateParts(cursor);
      const monthEnd = appLocalDateTime(
        cursorParts.month === 12 ? cursorParts.year + 1 : cursorParts.year,
        cursorParts.month === 12 ? 1 : cursorParts.month + 1,
        1,
      );
      const windowStart = cursor < start ? start : cursor;
      const windowEnd = monthEnd > horizonEnd ? horizonEnd : monthEnd;

      for (const target of spacedPeriodTargets(windowStart, windowEnd, activity.frequencyValue, activity)) {
        targets.push({ target, windowStart, windowEnd });
      }
    }

    return targets;
  }

  const horizonDays = Math.max(1, Math.ceil((horizonEnd.getTime() - start.getTime()) / DAY));
  const occurrenceCount = Math.round((activity.frequencyValue * horizonDays) / 365);

  for (const target of spacedPeriodTargets(start, horizonEnd, occurrenceCount, activity)) {
    targets.push({ target, windowStart: start, windowEnd: horizonEnd });
  }

  return targets;
}

function spacedPeriodTargets(
  windowStart: Date,
  windowEnd: Date,
  count: number,
  activity: Activity,
) {
  if (count <= 0 || windowEnd <= windowStart) {
    return [];
  }

  const targets: Date[] = [];
  const preferredHour = preferredHours(activity)[0];
  const periodLength = windowEnd.getTime() - windowStart.getTime();

  for (let index = 0; index < count; index += 1) {
    const midpoint = new Date(windowStart.getTime() + (periodLength * (index + 0.5)) / count);
    let target = dateAt(midpoint, preferredHour);

    if (target < windowStart) {
      target = windowStart;
    }

    if (target >= windowEnd) {
      target = addMinutes(windowEnd, -SLOT_STEP_MINUTES);
    }

    targets.push(target);
  }

  return targets;
}

function buildCandidateStarts(
  occurrence: OccurrenceTarget,
  activity: Activity,
) {
  const candidates: CandidateStart[] = [];
  const preferred = new Set(preferredHours(activity));

  for (let day = startOfDay(occurrence.windowStart); day < occurrence.windowEnd; day = addDays(day, 1)) {
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += SLOT_STEP_MINUTES) {
        const candidate = dateAt(day, hour, minute);

        if (candidate >= occurrence.windowStart && candidate < occurrence.windowEnd) {
          candidates.push({
            start: candidate,
            isPreferred: preferred.has(hour),
          });
        }
      }
    }
  }

  return candidates;
}

function scoredCandidateStarts(
  occurrence: OccurrenceTarget,
  activity: Activity,
  occupied: OccupiedSlot[],
) {
  return buildCandidateStarts(occurrence, activity)
    .map<ScoredCandidate>((candidate) => {
      const end = addMinutes(candidate.start, activity.durationMinutes);
      const targetDistance = minutesBetween(candidate.start, occurrence.target);
      const gapScore = nearestGapScore(candidate.start, end, occupied);
      const preferencePenalty = candidate.isPreferred ? 0 : 90;

      return {
        start: candidate.start,
        score: targetDistance + preferencePenalty - gapScore,
      };
    })
    .sort((left, right) => left.score - right.score || left.start.getTime() - right.start.getTime());
}

function placeOccurrence({
  activity,
  title,
  occurrence,
  clientId,
  occupied,
  activityOccupied,
  resourceOccupied,
  userAvailability,
  equipmentAvailability,
  userCapabilities,
  notes,
  failureReasons,
}: {
  activity: ActivityWithResources;
  title: string;
  occurrence: OccurrenceTarget;
  clientId: string;
  occupied: OccupiedSlot[];
  activityOccupied: ActivityOccupiedMap;
  resourceOccupied: ResourceOccupiedMap;
  userAvailability: ResourceAvailabilityMap;
  equipmentAvailability: ResourceAvailabilityMap;
  userCapabilities: UserCapabilityMap;
  notes: string;
  failureReasons?: Set<string>;
}): ScheduledDraft[] | null {
  const modes = possibleModes(activity);

  if (modes.length === 0) {
    failureReasons?.add("Activity requirements do not match any supported scheduling mode.");
    return null;
  }

  if (activity.allDay) {
    const startTime = startOfDay(occurrence.target);
    const endTime = endOfDay(occurrence.target);

    return [{
      activityId: activity.id,
      title,
      startTime,
      endTime,
      allDay: true,
      scheduleMode: "SELF_GUIDED",
      isManual: false,
      blocksScheduling: false,
      notes,
      staffIds: activity.staffIds,
      equipmentIds: activity.equipmentIds,
    }];
  }

  for (const candidate of scoredCandidateStarts(occurrence, activity, occupied)) {
    const startTime = candidate.start;
    const endTime = addMinutes(startTime, activity.durationMinutes);
    const prepStart = addMinutes(startTime, -activity.preparationMinutes);

    if (endTime > occurrence.windowEnd || prepStart < occurrence.windowStart) {
      continue;
    }

    if (tooCloseToSameActivity(activityOccupied, activity, startTime, endTime)) {
      continue;
    }

    for (const scheduleMode of modes) {
      const feasibilityInput = {
        start: startTime,
        end: endTime,
        activity,
        clientId,
        occupied,
        resourceOccupied,
        userAvailability,
        equipmentAvailability,
        userCapabilities,
        scheduleMode,
      };

      if (
        isFeasible(feasibilityInput)
      ) {
        const prepReasons = activity.preparationMinutes > 0
          ? prepFeasibilityReasons({
              prepStart,
              prepEnd: startTime,
              clientId,
              occupied,
              userAvailability,
            })
          : [];

        if (
          prepReasons.length > 0
        ) {
          if (failureReasons) {
            addReasons(failureReasons, prepReasons);
          }
          continue;
        }

        const slot = {
          start: startTime,
          end: endTime,
          blocksInPerson: true,
          blocksRemote: true,
        };
        const eventDrafts: ScheduledDraft[] = [];

        if (activity.preparationMinutes > 0) {
          const prepSlot = {
            start: prepStart,
            end: startTime,
            blocksInPerson: true,
            blocksRemote: true,
          };

          occupied.push(prepSlot);
          eventDrafts.push({
            activityId: null,
            title: `Prepare for ${title}`,
            startTime: prepStart,
            endTime: startTime,
            allDay: false,
            scheduleMode: "SELF_GUIDED",
            isManual: false,
            blocksScheduling: true,
            notes: "Preparation time for this activity.",
            staffIds: [],
            equipmentIds: [],
          });
        }

        occupied.push(slot);
        activityOccupied.set(activity.id, [...(activityOccupied.get(activity.id) ?? []), slot]);

        for (const staffId of activity.staffIds) {
          addResourceOccupation(resourceOccupied, staffId, slot);
        }

        for (const equipmentId of activity.equipmentIds) {
          addResourceOccupation(resourceOccupied, equipmentId, slot);
        }

        eventDrafts.push({
          activityId: activity.id,
          title,
          startTime,
          endTime,
          allDay: false,
          scheduleMode,
          isManual: false,
          blocksScheduling: true,
          notes,
          staffIds: activity.staffIds,
          equipmentIds: activity.equipmentIds,
        });

        return eventDrafts;
      }

    }
  }

  return null;
}

function mapResourceLinks(
  allActivities: Activity[],
  staffLinks: { activityId: string; staffId: string }[],
  equipmentLinks: { activityId: string; equipmentId: string }[],
  preparationRows: { activityId: string; durationMinutes: number }[],
) {
  const staffByActivity = new Map<string, string[]>();
  const equipmentByActivity = new Map<string, string[]>();
  const preparationByActivity = new Map<string, number>();

  for (const link of staffLinks) {
    staffByActivity.set(link.activityId, [
      ...(staffByActivity.get(link.activityId) ?? []),
      link.staffId,
    ]);
  }

  for (const link of equipmentLinks) {
    equipmentByActivity.set(link.activityId, [
      ...(equipmentByActivity.get(link.activityId) ?? []),
      link.equipmentId,
    ]);
  }

  for (const task of preparationRows) {
    preparationByActivity.set(
      task.activityId,
      (preparationByActivity.get(task.activityId) ?? 0) + task.durationMinutes,
    );
  }

  return new Map(
    allActivities.map((activity) => [
      activity.id,
      {
        ...activity,
        staffIds: staffByActivity.get(activity.id) ?? [],
        equipmentIds: equipmentByActivity.get(activity.id) ?? [],
        preparationMinutes: preparationByActivity.get(activity.id) ?? 0,
      },
    ]),
  );
}

function buildAvailabilityMap(slots: AvailabilitySlot[], key: "userId" | "equipmentId") {
  const map: ResourceAvailabilityMap = new Map();

  for (const slot of slots) {
    const id = slot[key];

    if (!id) {
      continue;
    }

    const current = map.get(id) ?? { available: [], unavailable: [] };

    if (slot.availabilityType === "AVAILABLE") {
      current.available.push(slot);
    } else {
      current.unavailable.push(slot);
    }

    map.set(id, current);
  }

  return map;
}

function copyManualEvents(events: CalendarEvent[]): ScheduledDraft[] {
  return events.map((event) => ({
    activityId: event.activityId,
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
    allDay: event.allDay,
    scheduleMode: event.scheduleMode,
    isManual: event.isManual,
    blocksScheduling: event.blocksScheduling,
    notes: event.notes,
    staffIds: [],
    equipmentIds: [],
  }));
}

export async function generateScheduleForClient({
  clientId,
  effectiveFrom = startOfDay(new Date()),
  horizonDays = 90,
}: {
  clientId: string;
  effectiveFrom?: Date;
  horizonDays?: number;
}): Promise<ScheduleGenerationResult> {
  const horizonEnd = addDays(effectiveFrom, horizonDays);

  return db.transaction(async (tx) => {
    const [client] = await tx.select().from(users).where(eq(users.id, clientId)).limit(1);

    if (!client || client.role !== "CLIENT") {
      throw new Error("Client not found.");
    }

    const [plan] = await tx
      .select()
      .from(actionPlans)
      .where(and(eq(actionPlans.clientId, clientId), eq(actionPlans.isCurrent, true)))
      .orderBy(desc(actionPlans.version))
      .limit(1);

    if (!plan) {
      throw new Error("Client does not have a current action plan.");
    }

    const planActivities = await tx
      .select()
      .from(activities)
      .where(eq(activities.actionPlanId, plan.id))
      .orderBy(asc(activities.priority), asc(activities.name));

    if (planActivities.length === 0) {
      throw new Error("Action plan has no activities to schedule.");
    }

    const activityIds = planActivities.map((activity) => activity.id);

    const [staffLinks, equipmentLinks, substitutions, preparationRows] = await Promise.all([
      tx.select().from(activityStaff).where(inArray(activityStaff.activityId, activityIds)),
      tx
        .select()
        .from(activityEquipment)
        .where(inArray(activityEquipment.activityId, activityIds)),
      tx
        .select()
        .from(activitySubstitutions)
        .where(inArray(activitySubstitutions.activityId, activityIds))
        .orderBy(asc(activitySubstitutions.priority)),
      tx.select().from(preparationTasks).where(inArray(preparationTasks.activityId, activityIds)),
    ]);

    const activitiesById = mapResourceLinks(planActivities, staffLinks, equipmentLinks, preparationRows);
    const allPlanActivities = planActivities
      .map((activity) => activitiesById.get(activity.id))
      .filter((activity): activity is ActivityWithResources => Boolean(activity));
    const primaryActivities = planActivities
      .filter((activity) => !activity.isBackup)
      .map((activity) => activitiesById.get(activity.id))
      .filter((activity): activity is ActivityWithResources => Boolean(activity));

    const userIds = dedupe([clientId, ...staffLinks.map((link) => link.staffId)]);
    const equipmentIds = dedupe(equipmentLinks.map((link) => link.equipmentId));

    const [userSlots, equipmentSlots, currentSchedules, userCapabilityRows] = await Promise.all([
      tx.select().from(availabilitySlots).where(inArray(availabilitySlots.userId, userIds)),
      equipmentIds.length > 0
        ? tx
            .select()
            .from(availabilitySlots)
            .where(inArray(availabilitySlots.equipmentId, equipmentIds))
        : Promise.resolve([]),
      tx
        .select()
        .from(schedules)
        .where(and(eq(schedules.clientId, clientId), eq(schedules.isCurrent, true)))
        .orderBy(desc(schedules.version))
        .limit(1),
      tx
        .select({
          id: users.id,
          supportsRemote: users.supportsRemote,
          supportsInPerson: users.supportsInPerson,
        })
        .from(users)
        .where(inArray(users.id, userIds)),
    ]);

    const currentSchedule = currentSchedules[0];
    const manualEvents = currentSchedule
      ? await tx
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.scheduleId, currentSchedule.id),
              eq(calendarEvents.isManual, true),
            ),
           )
      : [];

    const externalEvents = await tx
      .select({
        activityId: calendarEvents.activityId,
        startTime: calendarEvents.startTime,
        endTime: calendarEvents.endTime,
        allDay: calendarEvents.allDay,
        blocksScheduling: calendarEvents.blocksScheduling,
      })
      .from(calendarEvents)
      .innerJoin(schedules, eq(calendarEvents.scheduleId, schedules.id))
      .where(
        and(
          eq(schedules.isCurrent, true),
          ne(schedules.clientId, clientId),
          lt(calendarEvents.startTime, horizonEnd),
          gt(calendarEvents.endTime, effectiveFrom),
        ),
      );
    const externalActivityIds = dedupe(
      externalEvents
        .map((event) => event.activityId)
        .filter((activityId): activityId is string => Boolean(activityId)),
    );
    const [externalStaffLinks, externalEquipmentLinks] =
      externalActivityIds.length > 0
        ? await Promise.all([
            tx
              .select()
              .from(activityStaff)
              .where(inArray(activityStaff.activityId, externalActivityIds)),
            tx
              .select()
              .from(activityEquipment)
              .where(inArray(activityEquipment.activityId, externalActivityIds)),
          ])
        : [[], []];
    const externalStaffByActivity = new Map<string, string[]>();
    const externalEquipmentByActivity = new Map<string, string[]>();
    const resourceOccupied: ResourceOccupiedMap = new Map();
    const activityOccupied: ActivityOccupiedMap = new Map();

    for (const link of externalStaffLinks) {
      externalStaffByActivity.set(link.activityId, [
        ...(externalStaffByActivity.get(link.activityId) ?? []),
        link.staffId,
      ]);
    }

    for (const link of externalEquipmentLinks) {
      externalEquipmentByActivity.set(link.activityId, [
        ...(externalEquipmentByActivity.get(link.activityId) ?? []),
        link.equipmentId,
      ]);
    }

    for (const event of externalEvents) {
      if (!event.activityId) {
        continue;
      }

      const slot = {
        start: event.startTime,
        end: event.endTime,
        blocksInPerson: true,
        blocksRemote: true,
      };

      for (const staffId of externalStaffByActivity.get(event.activityId) ?? []) {
        if (!event.blocksScheduling) {
          continue;
        }

        addResourceOccupation(resourceOccupied, staffId, slot);
      }

      for (const equipmentId of externalEquipmentByActivity.get(event.activityId) ?? []) {
        if (!event.blocksScheduling) {
          continue;
        }

        addResourceOccupation(resourceOccupied, equipmentId, slot);
      }
    }

    const userAvailability = buildAvailabilityMap(userSlots, "userId");
    const equipmentAvailability = buildAvailabilityMap(equipmentSlots, "equipmentId");
    const userCapabilities: UserCapabilityMap = new Map(
      userCapabilityRows.map((user) => [
        user.id,
        {
          supportsRemote: user.supportsRemote,
          supportsInPerson: user.supportsInPerson,
        },
      ]),
    );
    const occupied: OccupiedSlot[] = manualEvents.map((event) => occupiedSlotForEvent(event));
    const drafts: ScheduledDraft[] = copyManualEvents(manualEvents);
    const unscheduledDrafts: UnscheduledDraft[] = [];
    const warnings: string[] = [];
    let unresolvedCount = 0;

    const substitutionsByActivity = new Map<string, ActivityWithResources[]>();

    for (const substitution of substitutions) {
      const substitute = activitiesById.get(substitution.substituteActivityId);

      if (!substitute) {
        continue;
      }

      substitutionsByActivity.set(substitution.activityId, [
        ...(substitutionsByActivity.get(substitution.activityId) ?? []),
        substitute,
      ]);
    }

    for (const activity of primaryActivities) {
      const targets = occurrenceTargets(activity, effectiveFrom, horizonEnd);
      let missed = 0;
      const failedWindows: MissedWindow[] = [];
      const failureReasons = new Set<string>();

      for (const occurrence of targets) {
        const primaryDraft = placeOccurrence({
          activity,
          title: activity.name,
          occurrence,
          clientId,
          occupied,
          activityOccupied,
          resourceOccupied,
          userAvailability,
          equipmentAvailability,
          userCapabilities,
          notes: activity.details,
          failureReasons,
        });

        if (primaryDraft) {
          drafts.push(...primaryDraft);
          continue;
        }

        let substituteDraft: ScheduledDraft[] | null = null;

        for (const substitute of substitutionsByActivity.get(activity.id) ?? []) {
          substituteDraft = placeOccurrence({
            activity: substitute,
            title: `${substitute.name} (backup for ${activity.name})`,
            occurrence,
            clientId,
            occupied,
            activityOccupied,
            resourceOccupied,
            userAvailability,
            equipmentAvailability,
            userCapabilities,
            notes: `Backup activity. Original details: ${activity.details}`,
            failureReasons,
          });

          if (substituteDraft) {
            break;
          }
        }

        if (substituteDraft) {
          drafts.push(...substituteDraft);
          continue;
        }

        missed += 1;
        failedWindows.push({
          windowStart: occurrence.windowStart,
          windowEnd: occurrence.windowEnd,
        });
      }

      if (missed > 0) {
        addReasons(failureReasons, diagnoseMissedActivity({
          activity,
          failedWindows,
          clientId,
          occupied,
          activityOccupied,
          resourceOccupied,
          userAvailability,
          equipmentAvailability,
          userCapabilities,
        }));
        unresolvedCount += missed;
        warnings.push(
          `${activity.name}: ${missed} occurrence${missed === 1 ? "" : "s"} could not be arranged.`,
        );
        unscheduledDrafts.push({
          activityId: activity.id,
          title: activity.name,
          missedCount: missed,
          failedWindows,
          reason: missedReason(failedWindows, [...failureReasons].sort()),
        });
      }
    }

    const nextVersion = (currentSchedule?.version ?? 0) + 1;
    const status = unresolvedCount > 0 ? "INVALID" : "VALID";

    await tx
      .update(schedules)
      .set({ isCurrent: false })
      .where(and(eq(schedules.clientId, clientId), eq(schedules.isCurrent, true)));

    const [newSchedule] = await tx
      .insert(schedules)
      .values({
        clientId,
        version: nextVersion,
        effectiveFrom,
        status,
        isCurrent: true,
      })
      .returning();

    const eventValues = drafts
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .map((draft) => ({
        scheduleId: newSchedule.id,
        activityId: draft.activityId,
        title: draft.title,
        startTime: draft.startTime,
        endTime: draft.endTime,
        allDay: draft.allDay,
        scheduleMode: draft.scheduleMode,
        isManual: draft.isManual,
        blocksScheduling: draft.blocksScheduling,
        notes: draft.notes,
      }));

    if (eventValues.length > 0) {
      await tx.insert(calendarEvents).values(eventValues);
    }

    if (unscheduledDrafts.length > 0) {
      await tx.insert(unscheduledActivities).values(
        unscheduledDrafts.map((draft) => ({
          scheduleId: newSchedule.id,
          activityId: draft.activityId,
          title: draft.title,
          missedCount: draft.missedCount,
          reason: draft.reason,
        })),
      );
    }

    const dependentStaffIds = dedupe([
      ...allPlanActivities.flatMap((activity) => activity.staffIds),
      ...drafts.flatMap((draft) => draft.staffIds),
    ]);
    const dependentEquipmentIds = dedupe([
      ...allPlanActivities.flatMap((activity) => activity.equipmentIds),
      ...drafts.flatMap((draft) => draft.equipmentIds),
    ]);
    const dependencyValues = [
      ...dependentStaffIds.map((userId) => ({
        scheduleId: newSchedule.id,
        userId,
        equipmentId: null,
      })),
      ...dependentEquipmentIds.map((equipmentId) => ({
        scheduleId: newSchedule.id,
        userId: null,
        equipmentId,
      })),
    ];

    if (dependencyValues.length > 0) {
      await tx.insert(scheduleDependencies).values(dependencyValues);
    }

    await tx
      .update(users)
      .set({ scheduleStatus: status, updatedAt: new Date() })
      .where(eq(users.id, clientId));

    return {
      scheduleId: newSchedule.id,
      version: nextVersion,
      scheduledCount: eventValues.filter((event) => !event.isManual).length,
      unresolvedCount,
      warnings,
    };
  });
}

export async function markSchedulesInvalidForStaff(staffId: string) {
  const affectedRows = await db
    .select({
      scheduleId: schedules.id,
      clientId: schedules.clientId,
      clientName: users.name,
    })
    .from(scheduleDependencies)
    .innerJoin(schedules, eq(scheduleDependencies.scheduleId, schedules.id))
    .innerJoin(users, eq(schedules.clientId, users.id))
    .where(
      and(
        eq(scheduleDependencies.userId, staffId),
        eq(schedules.isCurrent, true),
      ),
    )
    .orderBy(asc(users.id));

  const scheduleIds = dedupe(affectedRows.map((row) => row.scheduleId));
  const clientIds = dedupe(affectedRows.map((row) => row.clientId));

  if (scheduleIds.length > 0) {
    await db.update(schedules).set({ status: "INVALID" }).where(inArray(schedules.id, scheduleIds));
    await db
      .update(users)
      .set({ scheduleStatus: "INVALID", updatedAt: new Date() })
      .where(inArray(users.id, clientIds));
  }

  return affectedRows;
}

export async function markSchedulesInvalidForEquipment(equipmentId: string) {
  const affectedRows = await db
    .select({
      scheduleId: schedules.id,
      clientId: schedules.clientId,
      clientName: users.name,
    })
    .from(scheduleDependencies)
    .innerJoin(schedules, eq(scheduleDependencies.scheduleId, schedules.id))
    .innerJoin(users, eq(schedules.clientId, users.id))
    .where(
      and(
        eq(scheduleDependencies.equipmentId, equipmentId),
        eq(schedules.isCurrent, true),
      ),
    )
    .orderBy(asc(users.id));

  const scheduleIds = dedupe(affectedRows.map((row) => row.scheduleId));
  const clientIds = dedupe(affectedRows.map((row) => row.clientId));

  if (scheduleIds.length > 0) {
    await db.update(schedules).set({ status: "INVALID" }).where(inArray(schedules.id, scheduleIds));
    await db
      .update(users)
      .set({ scheduleStatus: "INVALID", updatedAt: new Date() })
      .where(inArray(users.id, clientIds));
  }

  await db
    .update(equipment)
    .set({ scheduleStatus: scheduleIds.length > 0 ? "INVALID" : "VALID", updatedAt: new Date() })
    .where(eq(equipment.id, equipmentId));

  return affectedRows;
}

export async function affectedClientsForStaff(staffId: string) {
  return db
    .select({
      scheduleId: schedules.id,
      clientId: schedules.clientId,
      clientName: users.name,
      description: users.description,
      email: users.email,
      phone: users.phone,
      dateJoined: users.dateJoined,
      status: schedules.status,
    })
    .from(scheduleDependencies)
    .innerJoin(schedules, eq(scheduleDependencies.scheduleId, schedules.id))
    .innerJoin(users, eq(schedules.clientId, users.id))
    .where(
      and(
        eq(scheduleDependencies.userId, staffId),
        eq(schedules.isCurrent, true),
        or(eq(schedules.status, "VALID"), eq(schedules.status, "INVALID")),
      ),
    )
    .orderBy(asc(users.id));
}

export async function affectedClientsForEquipment(equipmentId: string) {
  return db
    .select({
      scheduleId: schedules.id,
      clientId: schedules.clientId,
      clientName: users.name,
      description: users.description,
      email: users.email,
      phone: users.phone,
      dateJoined: users.dateJoined,
      status: schedules.status,
    })
    .from(scheduleDependencies)
    .innerJoin(schedules, eq(scheduleDependencies.scheduleId, schedules.id))
    .innerJoin(users, eq(schedules.clientId, users.id))
    .where(
      and(
        eq(scheduleDependencies.equipmentId, equipmentId),
        eq(schedules.isCurrent, true),
        or(eq(schedules.status, "VALID"), eq(schedules.status, "INVALID")),
      ),
    )
    .orderBy(asc(users.id));
}
