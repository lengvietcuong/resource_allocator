"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  actionPlans,
  activities,
  activityEquipment,
  activityMetrics,
  activityStaff,
  activitySubstitutions,
  availabilitySlots,
  calendarEvents,
  equipment,
  preparationTasks,
  schedules,
  scheduleDependencies,
  users,
  type Activity,
  type CalendarEvent,
  type Equipment,
  type User,
} from "@/lib/db/schema";
import {
  generateScheduleForClient,
  markSchedulesInvalidForEquipment,
  markSchedulesInvalidForStaff,
} from "@/lib/scheduler/scheduler";
import {
  actionPlanActivitySuggestionSchema,
  actionPlanSuggestionSchema,
  type ActionPlanActivitySuggestion,
} from "@/lib/action-plan-suggestions";
import {
  addLocalDays,
  localTimeRangeOnOrAfterDate,
  parseLocalDateTime,
  startOfLocalDay,
} from "@/lib/availability-time";

const activityTypes = ["FITNESS", "FOOD", "MEDICATION", "THERAPY", "CONSULTATION"] as const;
const frequencyUnits = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
const availabilityTypes = ["AVAILABLE", "UNAVAILABLE"] as const;
const availabilityEntityTypes = ["user", "equipment"] as const;
const availabilityHorizonDays = 90;

type StaffResource = Pick<User, "id" | "name" | "role">;
type EquipmentResource = Pick<Equipment, "id" | "name" | "type" | "location">;
type ResolvedGeneratedActivity = {
  activity: Omit<typeof activities.$inferInsert, "actionPlanId">;
  staff: StaffResource | null;
  equipment: EquipmentResource | null;
  metrics: string[];
  preparationTasks: string[];
};

function enumValue<const T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T,
): T[number] {
  const value = textValue(formData, key);

  if (!allowed.includes(value as T[number])) {
    throw new Error(`${key} is invalid.`);
  }

  return value;
}

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function optionalTextValue(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function numberValue(formData: FormData, key: string) {
  const value = Number(textValue(formData, key));

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive whole number.`);
  }

  return value;
}

function scheduleHorizonValue(formData: FormData) {
  const value = numberValue(formData, "horizonDays");

  if (value !== 30 && value !== 60 && value !== 90) {
    throw new Error("Planning span must be 30, 60, or 90 days.");
  }

  return value;
}

function priorityValue(formData: FormData, key = "priority") {
  const value = numberValue(formData, key);

  if (value < 1 || value > 4) {
    throw new Error("Priority must be Critical, High, Medium, or Low.");
  }

  return value;
}

function checkboxValue(formData: FormData, key: string) {
  return formData.getAll(key).includes("on");
}

function textArrayValue(formData: FormData, key: string) {
  return optionalTextValue(formData, key)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function csvValue(formData: FormData, key: string) {
  return optionalTextValue(formData, key)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function idListValue(formData: FormData, key: string) {
  return Array.from(new Set(
    formData
      .getAll(key)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  ));
}

function stableIndex(seed: string, length: number) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return length === 0 ? 0 : hash % length;
}

function pickStable<T>(items: T[], seed: string) {
  return items.length > 0 ? items[stableIndex(seed, items.length)] : null;
}

function preferredStaffRole(activity: ActionPlanActivitySuggestion): User["role"] | null {
  const text = `${activity.facilitatorRole ?? ""} ${activity.name} ${activity.details}`.toLowerCase();

  if (text.includes("doctor") || text.includes("clinician") || text.includes("medical") || activity.activityType === "MEDICATION") {
    return "DOCTOR";
  }

  if (text.includes("diet") || text.includes("nutrition") || activity.activityType === "FOOD") {
    return "DIETITIAN";
  }

  if (text.includes("physio") || text.includes("mobility") || text.includes("rehab")) {
    return "PHYSIOTHERAPIST";
  }

  if (text.includes("occupational") || text.includes("sleep") || text.includes("routine") || activity.activityType === "THERAPY") {
    return "OCCUPATIONAL_THERAPIST";
  }

  if (text.includes("speech") || text.includes("voice") || text.includes("communication")) {
    return "SPEECH_THERAPIST";
  }

  if (text.includes("trainer") || text.includes("strength") || text.includes("cardio") || activity.activityType === "FITNESS") {
    return "TRAINER";
  }

  return null;
}

function chooseGeneratedStaff(
  staffRows: StaffResource[],
  activity: ActionPlanActivitySuggestion,
  seed: string,
) {
  const preferredRole = preferredStaffRole(activity);
  const candidates = preferredRole
    ? staffRows.filter((staff) => staff.role === preferredRole)
    : staffRows;

  return pickStable(candidates.length > 0 ? candidates : staffRows, seed);
}

function equipmentSearchTerms(activity: ActionPlanActivitySuggestion) {
  const text = `${activity.equipmentType ?? ""} ${activity.name} ${activity.details}`.toLowerCase();

  if (text.includes("treadmill") || text.includes("zone 2") || text.includes("cardio") || text.includes("aerobic")) {
    return ["treadmill"];
  }

  if (text.includes("strength") || text.includes("rack") || text.includes("barbell") || text.includes("dumbbell")) {
    return ["strength"];
  }

  if (text.includes("body composition") || text.includes("inbody") || text.includes("dexa")) {
    return ["body composition"];
  }

  if (text.includes("blood") || text.includes("biomarker") || text.includes("phlebotomy")) {
    return ["blood testing"];
  }

  if (text.includes("telehealth") || text.includes("video") || text.includes("remote consult")) {
    return ["consultation"];
  }

  if (text.includes("sauna")) {
    return ["sauna"];
  }

  if (text.includes("red light")) {
    return ["red light"];
  }

  if (text.includes("cold plunge") || text.includes("cold therapy")) {
    return ["cold therapy"];
  }

  if (text.includes("hbot") || text.includes("hyperbaric")) {
    return ["hyperbaric"];
  }

  if (text.includes("massage") || text.includes("manual therapy") || text.includes("physio")) {
    return ["physiotherapy"];
  }

  if (activity.equipmentType) {
    return activity.equipmentType.toLowerCase().split(/\s+|\//).filter((term) => term.length > 2);
  }

  return [];
}

function chooseGeneratedEquipment(
  equipmentRows: EquipmentResource[],
  activity: ActionPlanActivitySuggestion,
  seed: string,
) {
  const terms = equipmentSearchTerms(activity);

  if (terms.length === 0) {
    return null;
  }

  const candidates = equipmentRows.filter((item) => {
    const haystack = `${item.name} ${item.type} ${item.location}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });

  return pickStable(candidates.length > 0 ? candidates : equipmentRows, seed);
}

function defaultMetrics(activityType: ActionPlanActivitySuggestion["activityType"]) {
  if (activityType === "FITNESS") {
    return ["Session completion", "RPE"];
  }

  if (activityType === "FOOD") {
    return ["Meal adherence", "Protein grams"];
  }

  if (activityType === "MEDICATION") {
    return ["Dose adherence", "Symptoms"];
  }

  if (activityType === "THERAPY") {
    return ["Session completion", "Recovery score"];
  }

  return ["Actions completed", "Follow-up items"];
}

function defaultPreparation(activityType: ActionPlanActivitySuggestion["activityType"]) {
  if (activityType === "FITNESS") {
    return ["Confirm kit and wearable", "Reserve space or equipment"];
  }

  if (activityType === "FOOD") {
    return ["Confirm meal option", "Prepare travel-safe backup"];
  }

  if (activityType === "MEDICATION") {
    return ["Confirm medication timing", "Check refill status"];
  }

  if (activityType === "THERAPY") {
    return ["Block a quiet window", "Prepare recovery notes"];
  }

  return ["Collect recent data", "Prepare questions for the care team"];
}

function resolveGeneratedActivity({
  suggestedActivity,
  staffRows,
  equipmentRows,
  seed,
}: {
  suggestedActivity: ActionPlanActivitySuggestion;
  staffRows: StaffResource[];
  equipmentRows: EquipmentResource[];
  seed: string;
}): ResolvedGeneratedActivity {
  const staff = chooseGeneratedStaff(staffRows, suggestedActivity, `${seed}-staff`);
  const selectedEquipment = chooseGeneratedEquipment(equipmentRows, suggestedActivity, `${seed}-equipment`);
  const metrics = suggestedActivity.metrics.length > 0 ? suggestedActivity.metrics : defaultMetrics(suggestedActivity.activityType);
  const preparationTasks = suggestedActivity.preparationTasks.length > 0
    ? suggestedActivity.preparationTasks
    : defaultPreparation(suggestedActivity.activityType);
  const skippedAdjustment = suggestedActivity.skippedAdjustment
    ?? (suggestedActivity.backupActivities[0]
      ? `Use backup: ${suggestedActivity.backupActivities[0]}.`
      : "Reschedule a shorter version within the same week.");

  return {
    activity: {
      priority: suggestedActivity.priority,
      name: suggestedActivity.name,
      activityType: suggestedActivity.activityType,
      frequencyValue: suggestedActivity.frequencyValue,
      frequencyUnit: suggestedActivity.frequencyUnit,
      durationMinutes: suggestedActivity.durationMinutes,
      details: suggestedActivity.details,
      location: suggestedActivity.location ?? selectedEquipment?.location ?? (suggestedActivity.canBeRemote ? "Remote" : "Elyx clinic"),
      skippedAdjustment,
      supportsRemote: suggestedActivity.canBeRemote ?? selectedEquipment === null,
      supportsInPerson: true,
      allDay: false,
    },
    staff,
    equipment: selectedEquipment,
    metrics,
    preparationTasks,
  };
}

function weekdayValues(formData: FormData) {
  const weekdays = formData
    .getAll("weekdays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

  return Array.from(new Set(weekdays));
}

async function availabilityBaseDate() {
  return startOfLocalDay(new Date());
}

function availabilityRowsFromForm({
  entityType,
  entityId,
  baseDate,
  availabilityType,
  weekdays,
  startTime,
  endTime,
}: {
  entityType: "user" | "equipment";
  entityId: string;
  baseDate: Date;
  availabilityType: (typeof availabilityTypes)[number];
  weekdays: number[];
  startTime: string;
  endTime: string;
}) {
  const rows: (typeof availabilitySlots.$inferInsert)[] = [];

  for (let dayIndex = 0; dayIndex < availabilityHorizonDays; dayIndex += 1) {
    const day = addLocalDays(baseDate, dayIndex);

    if (!weekdays.includes(day.getDay())) {
      continue;
    }

    const { startsAt, endsAt } = localTimeRangeOnOrAfterDate(day, startTime, endTime);

    rows.push({
      userId: entityType === "user" ? entityId : null,
      equipmentId: entityType === "equipment" ? entityId : null,
      startsAt,
      endsAt,
      availabilityType,
    });
  }

  return rows;
}

async function markAvailabilityOwnerChanged(
  entityType: "user" | "equipment",
  entityId: string,
  updateRelevantSchedules: boolean,
) {
  if (entityType === "equipment") {
    const affected = await markSchedulesInvalidForEquipment(entityId);

    if (updateRelevantSchedules) {
      for (const row of affected) {
        await regenerateClientScheduleIfPossible(row.clientId);
      }
    }

    return;
  }

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, entityId))
    .limit(1);

  if (user?.role === "CLIENT") {
    await markClientScheduleInvalid(entityId);

    if (updateRelevantSchedules) {
      await regenerateClientScheduleIfPossible(entityId);
    }
  } else {
    const affected = await markSchedulesInvalidForStaff(entityId);

    if (updateRelevantSchedules) {
      for (const row of affected) {
        await regenerateClientScheduleIfPossible(row.clientId);
      }
    }
  }
}

function redirectTarget(formData: FormData, fallback = "/") {
  const value = formData.get("redirectTo");
  return typeof value === "string" && value.startsWith("/") ? value : fallback;
}

type ToastType = "success" | "error";

const userSafeErrorMessages = new Set([
  "Priority must be Critical, High, Medium, or Low.",
  "Date or time is invalid.",
  "Time is invalid.",
  "End time must be after start time.",
  "End date and time must be after the start.",
  "Schedule start date cannot be in the past.",
  "At least one activity is required.",
  "Choose at least one day of the week.",
  "That time slot is unavailable. Choose another available time.",
]);

function redirectWithToast(target: string, message: string, type: ToastType) {
  const url = new URL(target, "http://resource-allocator.local");

  url.searchParams.set("toast", message);
  url.searchParams.set("toastType", type);

  return `${url.pathname}${url.search}${url.hash}`;
}

function clientCalendarRedirect(target: string, clientId: string) {
  const url = new URL(target, "http://resource-allocator.local");

  url.searchParams.set("tab", "clients");
  url.searchParams.set("clientId", clientId);
  url.searchParams.set("subtab", "calendar");
  url.searchParams.delete("staffId");
  url.searchParams.delete("equipmentId");

  return `${url.pathname}${url.search}${url.hash}`;
}

function actionErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && userSafeErrorMessages.has(error.message) ? error.message : fallback;
}

async function markClientScheduleInvalid(clientId: string) {
  const [currentSchedule, client] = await Promise.all([
    db
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(eq(schedules.clientId, clientId), eq(schedules.isCurrent, true)))
      .limit(1),
    db
      .select({ scheduleStatus: users.scheduleStatus })
      .from(users)
      .where(eq(users.id, clientId))
      .limit(1),
  ]);

  if (!currentSchedule[0]) {
    await db
      .update(users)
      .set({
        scheduleStatus: client[0]?.scheduleStatus === "NO_ACTION_PLAN" ? "NO_ACTION_PLAN" : "NO_SCHEDULE",
        updatedAt: new Date(),
      })
      .where(eq(users.id, clientId));
    return;
  }

  await db.update(schedules).set({ status: "INVALID" }).where(eq(schedules.id, currentSchedule[0].id));
  await db
    .update(users)
    .set({ scheduleStatus: "INVALID", updatedAt: new Date() })
    .where(eq(users.id, clientId));
}

async function regenerateClientScheduleIfPossible(clientId: string) {
  const [plan] = await db
    .select({ id: actionPlans.id })
    .from(actionPlans)
    .where(and(eq(actionPlans.clientId, clientId), eq(actionPlans.isCurrent, true)))
    .limit(1);

  if (plan) {
    await generateScheduleForClient({ clientId });
  }
}

function cloneEventValue(
  event: CalendarEvent,
  scheduleId: string,
): typeof calendarEvents.$inferInsert {
  return {
    scheduleId,
    activityId: event.activityId,
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
    allDay: event.allDay,
    isManual: event.isManual,
    blocksScheduling: event.blocksScheduling,
    scheduleMode: event.scheduleMode,
    notes: event.notes,
  };
}

async function createScheduleVersion({
  clientId,
  excludeEventId,
  excludeEventIds,
  appendEvent,
  preserveStatus = false,
}: {
  clientId: string;
  excludeEventId?: string;
  excludeEventIds?: string[];
  appendEvent?: (scheduleId: string) => typeof calendarEvents.$inferInsert;
  preserveStatus?: boolean;
}) {
  await db.transaction(async (tx) => {
    const [currentSchedule] = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.clientId, clientId), eq(schedules.isCurrent, true)))
      .orderBy(desc(schedules.version))
      .limit(1);
    const existingEvents = currentSchedule
      ? await tx
          .select()
          .from(calendarEvents)
          .where(eq(calendarEvents.scheduleId, currentSchedule.id))
      : [];
    const existingDependencies = currentSchedule
      ? await tx
          .select()
          .from(scheduleDependencies)
          .where(eq(scheduleDependencies.scheduleId, currentSchedule.id))
      : [];

    if (currentSchedule) {
      await tx
        .update(schedules)
        .set({ isCurrent: false })
        .where(eq(schedules.id, currentSchedule.id));
    }

    const [newSchedule] = await tx
      .insert(schedules)
      .values({
        clientId,
        version: (currentSchedule?.version ?? 0) + 1,
        effectiveFrom: currentSchedule?.effectiveFrom ?? new Date(),
        status: preserveStatus ? (currentSchedule?.status ?? "VALID") : "INVALID",
        isCurrent: true,
      })
      .returning();
    const excludedEventIds = new Set([
      ...(excludeEventId ? [excludeEventId] : []),
      ...(excludeEventIds ?? []),
    ]);
    const copiedEvents = existingEvents
      .filter((event) => !excludedEventIds.has(event.id))
      .map((event) => cloneEventValue(event, newSchedule.id));

    if (appendEvent) {
      copiedEvents.push(appendEvent(newSchedule.id));
    }

    if (copiedEvents.length > 0) {
      await tx.insert(calendarEvents).values(copiedEvents);
    }

    const copiedDependencies = existingDependencies.map((dependency) => ({
      scheduleId: newSchedule.id,
      userId: dependency.userId,
      equipmentId: dependency.equipmentId,
    }));

    if (copiedDependencies.length > 0) {
      await tx.insert(scheduleDependencies).values(copiedDependencies);
    }

    await tx
      .update(users)
      .set({
        scheduleStatus: preserveStatus ? (currentSchedule?.status ?? "VALID") : "INVALID",
        updatedAt: new Date(),
      })
      .where(eq(users.id, clientId));
  });
}

function preparationTitleFor(title: string) {
  return `Prepare for ${title}`;
}

function isAdjacentPreparationEvent(
  event: { activityId: string | null; title: string; endTime: Date },
  title: string,
  primaryStart: Date,
) {
  return (
    event.activityId === null &&
    event.title === preparationTitleFor(title) &&
    event.endTime.getTime() === primaryStart.getTime()
  );
}

function rangesOverlap(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function rangeContains(containerStart: Date, containerEnd: Date, start: Date, end: Date) {
  return containerStart <= start && containerEnd >= end;
}

function resourceHasAvailability(
  slots: { startsAt: Date; endsAt: Date; availabilityType: "AVAILABLE" | "UNAVAILABLE" }[],
  start: Date,
  end: Date,
) {
  const unavailable = slots.some((slot) =>
    slot.availabilityType === "UNAVAILABLE" && rangesOverlap(start, end, slot.startsAt, slot.endsAt),
  );

  if (unavailable) {
    return false;
  }

  const availableSlots = slots
    .filter((slot) => slot.availabilityType === "AVAILABLE")
    .map((slot) => ({ start: slot.startsAt, end: slot.endsAt }))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const mergedSlots: { start: Date; end: Date }[] = [];

  for (const slot of availableSlots) {
    const previous = mergedSlots.at(-1);

    if (previous && slot.start <= previous.end) {
      if (slot.end > previous.end) {
        previous.end = slot.end;
      }
    } else {
      mergedSlots.push({ ...slot });
    }
  }

  return mergedSlots.some((slot) => rangeContains(slot.start, slot.end, start, end));
}

async function validateEditedEventTime({
  eventId,
  ignoredEventIds = [],
  clientId,
  activityId,
  blocksScheduling,
  scheduleMode,
  startTime,
  endTime,
}: {
  eventId: string;
  ignoredEventIds?: string[];
  clientId: string;
  activityId: string | null;
  blocksScheduling: boolean;
  scheduleMode: "SELF_GUIDED" | "REMOTE" | "IN_PERSON";
  startTime: Date;
  endTime: Date;
}) {
  const [staffLinks, equipmentLinks] = activityId
    ? await Promise.all([
        db.select({ staffId: activityStaff.staffId }).from(activityStaff).where(eq(activityStaff.activityId, activityId)),
        db.select({ equipmentId: activityEquipment.equipmentId }).from(activityEquipment).where(eq(activityEquipment.activityId, activityId)),
      ])
    : [[], []];
  const staffIds = staffLinks.map((link) => link.staffId);
  const equipmentIds = equipmentLinks.map((link) => link.equipmentId);
  const userIds = [clientId, ...staffIds];
  const [userSlots, equipmentSlots, staffCapabilities] = await Promise.all([
    db.select().from(availabilitySlots).where(inArray(availabilitySlots.userId, userIds)),
    equipmentIds.length > 0
      ? db.select().from(availabilitySlots).where(inArray(availabilitySlots.equipmentId, equipmentIds))
      : Promise.resolve([]),
    staffIds.length > 0
      ? db
          .select({
            id: users.id,
            supportsRemote: users.supportsRemote,
            supportsInPerson: users.supportsInPerson,
          })
          .from(users)
          .where(inArray(users.id, staffIds))
      : Promise.resolve([]),
  ]);
  const capabilityByStaff = new Map(staffCapabilities.map((staff) => [staff.id, staff]));

  for (const staffId of staffIds) {
    const capability = capabilityByStaff.get(staffId);

    if (scheduleMode === "REMOTE" && capability?.supportsRemote !== true) {
      throw new Error("That time slot is unavailable. Choose another available time.");
    }

    if (scheduleMode === "IN_PERSON" && capability?.supportsInPerson === false) {
      throw new Error("That time slot is unavailable. Choose another available time.");
    }
  }

  for (const userId of userIds) {
    const slots = userSlots.filter((slot) => slot.userId === userId);

    if (!resourceHasAvailability(slots, startTime, endTime)) {
      throw new Error("That time slot is unavailable. Choose another available time.");
    }
  }

  for (const equipmentId of equipmentIds) {
    const slots = equipmentSlots.filter((slot) => slot.equipmentId === equipmentId);

    if (!resourceHasAvailability(slots, startTime, endTime)) {
      throw new Error("That time slot is unavailable. Choose another available time.");
    }
  }

  if (!blocksScheduling) {
    return;
  }

  const ignoredIds = new Set([eventId, ...ignoredEventIds]);
  const currentEvents = await db
    .select({
      id: calendarEvents.id,
      activityId: calendarEvents.activityId,
      clientId: schedules.clientId,
      startTime: calendarEvents.startTime,
      endTime: calendarEvents.endTime,
      blocksScheduling: calendarEvents.blocksScheduling,
    })
    .from(calendarEvents)
    .innerJoin(schedules, and(eq(calendarEvents.scheduleId, schedules.id), eq(schedules.isCurrent, true)));
  const overlappingEvents = currentEvents.filter((event) =>
    !ignoredIds.has(event.id) &&
    event.blocksScheduling &&
    rangesOverlap(startTime, endTime, event.startTime, event.endTime),
  );

  if (overlappingEvents.some((event) => event.clientId === clientId)) {
    throw new Error("That time slot is unavailable. Choose another available time.");
  }

  const overlappingActivityIds = overlappingEvents
    .map((event) => event.activityId)
    .filter((value): value is string => Boolean(value));

  if (overlappingActivityIds.length === 0) {
    return;
  }

  const [overlappingStaff, overlappingEquipment] = await Promise.all([
    staffIds.length > 0
      ? db.select().from(activityStaff).where(inArray(activityStaff.activityId, overlappingActivityIds))
      : Promise.resolve([]),
    equipmentIds.length > 0
      ? db.select().from(activityEquipment).where(inArray(activityEquipment.activityId, overlappingActivityIds))
      : Promise.resolve([]),
  ]);
  const staffSet = new Set(staffIds);
  const equipmentSet = new Set(equipmentIds);
  const staffConflict = overlappingStaff.some((link) => staffSet.has(link.staffId));
  const equipmentConflict = overlappingEquipment.some((link) => equipmentSet.has(link.equipmentId));

  if (staffConflict || equipmentConflict) {
    throw new Error("That time slot is unavailable. Choose another available time.");
  }
}

function activityInsertFromForm(
  formData: FormData,
  actionPlanId: string,
): typeof activities.$inferInsert {
  return {
    actionPlanId,
    priority: priorityValue(formData),
    name: textValue(formData, "name"),
    activityType: enumValue(formData, "activityType", activityTypes),
    frequencyValue: numberValue(formData, "frequencyValue"),
    frequencyUnit: enumValue(formData, "frequencyUnit", frequencyUnits),
    durationMinutes: numberValue(formData, "durationMinutes"),
    details: textValue(formData, "details"),
    location: optionalTextValue(formData, "location") || null,
    skippedAdjustment: optionalTextValue(formData, "skippedAdjustment") || null,
    supportsRemote: formData.has("supportsRemote") ? checkboxValue(formData, "supportsRemote") : null,
    supportsInPerson: formData.has("supportsInPerson") ? checkboxValue(formData, "supportsInPerson") : null,
    allDay: checkboxValue(formData, "allDay"),
    isBackup: false,
  };
}

function cloneActivityValue(
  activity: Activity,
  actionPlanId: string,
): typeof activities.$inferInsert {
  return {
    actionPlanId,
    priority: activity.priority,
    name: activity.name,
    activityType: activity.activityType,
    frequencyValue: activity.frequencyValue,
    frequencyUnit: activity.frequencyUnit,
    durationMinutes: activity.durationMinutes,
    details: activity.details,
    location: activity.location,
    skippedAdjustment: activity.skippedAdjustment,
    supportsRemote: activity.supportsRemote,
    supportsInPerson: activity.supportsInPerson,
    allDay: activity.allDay,
    isBackup: activity.isBackup,
  };
}

function resourcesForActivity(
  activity: Pick<typeof activities.$inferInsert, "allDay">,
  resources?: { staffIds: string[]; equipmentIds: string[] },
) {
  if (activity.allDay) {
    return { staffIds: [], equipmentIds: [] };
  }

  return resources ?? { staffIds: [], equipmentIds: [] };
}

function backupActivityValue({
  primary,
  name,
  actionPlanId,
  priorityOffset = 1,
}: {
  primary: Pick<
    Activity,
    | "activityType"
    | "details"
    | "durationMinutes"
    | "frequencyUnit"
    | "frequencyValue"
    | "location"
    | "name"
    | "priority"
    | "supportsInPerson"
    | "supportsRemote"
  >;
  name: string;
  actionPlanId: string;
  priorityOffset?: number;
}): typeof activities.$inferInsert {
  return {
    actionPlanId,
    priority: Math.min(4, primary.priority + priorityOffset),
    name,
    activityType: primary.activityType,
    frequencyValue: primary.frequencyValue,
    frequencyUnit: primary.frequencyUnit,
    durationMinutes: Math.min(primary.durationMinutes, 30),
    details: `Backup option for ${primary.name}.`,
    location: primary.supportsRemote ? "Flexible" : primary.location,
    skippedAdjustment: null,
    supportsRemote: true,
    supportsInPerson: primary.supportsInPerson ?? true,
    allDay: false,
    isBackup: true,
  };
}

async function createActionPlanVersion({
  clientId,
  excludeActivityId,
  appendActivity,
  appendActivityResources,
  replaceActivity,
}: {
  clientId: string;
  excludeActivityId?: string;
  appendActivity?: (actionPlanId: string) => typeof activities.$inferInsert;
  appendActivityResources?: { staffIds: string[]; equipmentIds: string[] };
  replaceActivity?: {
    activityId: string;
    values: (actionPlanId: string, activity: Activity) => typeof activities.$inferInsert;
    staffIds?: string[];
    equipmentIds?: string[];
  };
}) {
  await db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(actionPlans)
      .where(and(eq(actionPlans.clientId, clientId), eq(actionPlans.isCurrent, true)))
      .orderBy(desc(actionPlans.version))
      .limit(1);

    if (!plan) {
      if (!appendActivity || excludeActivityId || replaceActivity) {
        throw new Error("Client does not have a current action plan.");
      }

      const [newPlan] = await tx
        .insert(actionPlans)
        .values({
          clientId,
          version: 1,
          effectiveFrom: new Date(),
          isCurrent: true,
        })
        .returning();

      const appendValue = appendActivity(newPlan.id);
      const appendResources = resourcesForActivity(appendValue, appendActivityResources);
      const [activity] = await tx.insert(activities).values(appendValue).returning();

      if (appendResources.staffIds.length) {
        await tx.insert(activityStaff).values(
          appendResources.staffIds.map((staffId) => ({ activityId: activity.id, staffId })),
        );
      }

      if (appendResources.equipmentIds.length) {
        await tx.insert(activityEquipment).values(
          appendResources.equipmentIds.map((equipmentId) => ({ activityId: activity.id, equipmentId })),
        );
      }

      await tx
        .update(users)
        .set({ scheduleStatus: "NO_SCHEDULE", updatedAt: new Date() })
        .where(eq(users.id, clientId));
      return;
    }

    const existingActivities = await tx
      .select()
      .from(activities)
      .where(eq(activities.actionPlanId, plan.id));
    const copiedActivities = existingActivities.filter(
      (activity) => activity.id !== excludeActivityId,
    );
    const existingActivityIds = existingActivities.map((activity) => activity.id);
    const [staffLinks, equipmentLinks, metricRows, preparationRows, substitutionRows] =
      existingActivityIds.length > 0
        ? await Promise.all([
            tx.select().from(activityStaff).where(inArray(activityStaff.activityId, existingActivityIds)),
            tx
              .select()
              .from(activityEquipment)
              .where(inArray(activityEquipment.activityId, existingActivityIds)),
            tx
              .select()
              .from(activityMetrics)
              .where(inArray(activityMetrics.activityId, existingActivityIds)),
            tx
              .select()
              .from(preparationTasks)
              .where(inArray(preparationTasks.activityId, existingActivityIds)),
            tx
              .select()
              .from(activitySubstitutions)
              .where(inArray(activitySubstitutions.activityId, existingActivityIds)),
          ])
        : [[], [], [], [], []];

    await tx
      .update(actionPlans)
      .set({ isCurrent: false })
      .where(and(eq(actionPlans.clientId, clientId), eq(actionPlans.isCurrent, true)));

    const [newPlan] = await tx
      .insert(actionPlans)
      .values({
        clientId,
        version: plan.version + 1,
        effectiveFrom: new Date(),
        isCurrent: true,
      })
      .returning();
    const activityIdMap = new Map<string, string>();

    for (const activity of copiedActivities) {
      const activityValue = replaceActivity?.activityId === activity.id
        ? replaceActivity.values(newPlan.id, activity)
        : cloneActivityValue(activity, newPlan.id);
      const [newActivity] = await tx.insert(activities).values(activityValue).returning();
      activityIdMap.set(activity.id, newActivity.id);
    }

    if (appendActivity) {
      const appendValue = appendActivity(newPlan.id);
      const appendResources = resourcesForActivity(appendValue, appendActivityResources);
      const [activity] = await tx.insert(activities).values(appendValue).returning();

      if (appendResources.staffIds.length) {
        await tx.insert(activityStaff).values(
          appendResources.staffIds.map((staffId) => ({ activityId: activity.id, staffId })),
        );
      }

      if (appendResources.equipmentIds.length) {
        await tx.insert(activityEquipment).values(
          appendResources.equipmentIds.map((equipmentId) => ({ activityId: activity.id, equipmentId })),
        );
      }
    }

    const copiedStaffLinks = staffLinks
      .filter((link) => link.activityId !== replaceActivity?.activityId || !replaceActivity.staffIds)
      .map((link) => ({ activityId: activityIdMap.get(link.activityId), staffId: link.staffId }))
      .filter((link): link is { activityId: string; staffId: string } => Boolean(link.activityId));
    const copiedEquipmentLinks = equipmentLinks
      .filter((link) => link.activityId !== replaceActivity?.activityId || !replaceActivity.equipmentIds)
      .map((link) => ({
        activityId: activityIdMap.get(link.activityId),
        equipmentId: link.equipmentId,
      }))
      .filter(
        (link): link is { activityId: string; equipmentId: string } => Boolean(link.activityId),
      );
    const replacedActivityId = replaceActivity ? activityIdMap.get(replaceActivity.activityId) : null;

    const replacedActivity = replaceActivity
      ? copiedActivities.find((activity) => activity.id === replaceActivity.activityId)
      : null;
    const replacedActivityResources = replacedActivityId && replaceActivity && replacedActivity
      ? resourcesForActivity(replaceActivity.values(newPlan.id, replacedActivity), {
          staffIds: replaceActivity.staffIds ?? [],
          equipmentIds: replaceActivity.equipmentIds ?? [],
        })
      : null;

    if (replacedActivityId && replaceActivity?.staffIds && replacedActivityResources) {
      copiedStaffLinks.push(
        ...replacedActivityResources.staffIds.map((staffId) => ({ activityId: replacedActivityId, staffId })),
      );
    }

    if (replacedActivityId && replaceActivity?.equipmentIds && replacedActivityResources) {
      copiedEquipmentLinks.push(
        ...replacedActivityResources.equipmentIds.map((equipmentId) => ({ activityId: replacedActivityId, equipmentId })),
      );
    }
    const copiedMetrics = metricRows
      .map((metric) => ({
        activityId: activityIdMap.get(metric.activityId),
        name: metric.name,
        unit: metric.unit,
      }))
      .filter(
        (metric): metric is { activityId: string; name: string; unit: string } =>
          Boolean(metric.activityId),
      );
    const copiedPreparation = preparationRows
      .map((task) => ({
        activityId: activityIdMap.get(task.activityId),
        name: task.name,
        durationMinutes: task.durationMinutes,
      }))
      .filter(
        (task): task is { activityId: string; name: string; durationMinutes: number } =>
          Boolean(task.activityId),
      );
    const copiedSubstitutions = substitutionRows
      .map((substitution) => ({
        activityId: activityIdMap.get(substitution.activityId),
        substituteActivityId: activityIdMap.get(substitution.substituteActivityId),
        priority: substitution.priority,
      }))
      .filter(
        (substitution): substitution is {
          activityId: string;
          substituteActivityId: string;
          priority: number;
        } => Boolean(substitution.activityId && substitution.substituteActivityId),
      );

    if (copiedStaffLinks.length > 0) {
      await tx.insert(activityStaff).values(copiedStaffLinks);
    }

    if (copiedEquipmentLinks.length > 0) {
      await tx.insert(activityEquipment).values(copiedEquipmentLinks);
    }

    if (copiedMetrics.length > 0) {
      await tx.insert(activityMetrics).values(copiedMetrics);
    }

    if (copiedPreparation.length > 0) {
      await tx.insert(preparationTasks).values(copiedPreparation);
    }

    if (copiedSubstitutions.length > 0) {
      await tx.insert(activitySubstitutions).values(copiedSubstitutions);
    }
  });

  await markClientScheduleInvalid(clientId);
}

async function replaceActionPlanWithSuggestedActivities(
  clientId: string,
  suggestedActivities: ActionPlanActivitySuggestion[],
) {
  const parsed = actionPlanSuggestionSchema.parse({ activities: suggestedActivities });
  const createdActivities: {
    id: string;
    priority: number;
    name: string;
    activityType: (typeof activityTypes)[number];
    frequencyValue: number;
    frequencyUnit: (typeof frequencyUnits)[number];
    durationMinutes: number;
    allDay: boolean;
    details: string;
    location: string | null;
    skippedAdjustment: string | null;
    supportsRemote: boolean | null;
    supportsInPerson: boolean | null;
    staffIds: string[];
    staffNames: string[];
    equipmentIds: string[];
    equipmentNames: string[];
    metricLabels: string[];
    preparationLabels: string[];
  }[] = [];

  await db.transaction(async (tx) => {
    const [currentPlan] = await tx
      .select()
      .from(actionPlans)
      .where(and(eq(actionPlans.clientId, clientId), eq(actionPlans.isCurrent, true)))
      .orderBy(desc(actionPlans.version))
      .limit(1);

    if (currentPlan) {
      await tx
        .update(actionPlans)
        .set({ isCurrent: false })
        .where(eq(actionPlans.id, currentPlan.id));
    }

    const [newPlan] = await tx
      .insert(actionPlans)
      .values({
        clientId,
        version: (currentPlan?.version ?? 0) + 1,
        effectiveFrom: new Date(),
        isCurrent: true,
      })
      .returning();
    const [staffRows, equipmentRows] = await Promise.all([
      tx
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(and(ne(users.role, "CLIENT"), ne(users.role, "ADMIN"))),
      tx
        .select({ id: equipment.id, name: equipment.name, type: equipment.type, location: equipment.location })
        .from(equipment),
    ]);

    for (const [index, suggestedActivity] of parsed.activities.entries()) {
      const resolved = resolveGeneratedActivity({
        suggestedActivity,
        staffRows,
        equipmentRows,
        seed: `${clientId}-${suggestedActivity.name}-${index}`,
      });
      const [activity] = await tx
        .insert(activities)
        .values({
          actionPlanId: newPlan.id,
          ...resolved.activity,
          priority: resolved.activity.priority || index + 1,
        })
        .returning();

      if (resolved.staff) {
        await tx.insert(activityStaff).values({ activityId: activity.id, staffId: resolved.staff.id });
      }

      if (resolved.equipment) {
        await tx.insert(activityEquipment).values({ activityId: activity.id, equipmentId: resolved.equipment.id });
      }

      const metrics = resolved.metrics.map((name) => ({
        activityId: activity.id,
        name,
        unit: "tracked",
      }));
      const preparation = resolved.preparationTasks.map((name) => ({
        activityId: activity.id,
        name,
        durationMinutes: 5,
      }));

      if (metrics.length > 0) {
        await tx.insert(activityMetrics).values(metrics);
      }

      if (preparation.length > 0) {
        await tx.insert(preparationTasks).values(preparation);
      }

      const backupNames = suggestedActivity.backupActivities
        .map((name) => name.trim())
        .filter(Boolean);

      for (const [backupIndex, backupName] of backupNames.entries()) {
        const [backupActivity] = await tx
          .insert(activities)
          .values(backupActivityValue({
            primary: activity,
            name: backupName,
            actionPlanId: newPlan.id,
            priorityOffset: backupIndex + 1,
          }))
          .returning();

        await tx.insert(activitySubstitutions).values({
          activityId: activity.id,
          substituteActivityId: backupActivity.id,
          priority: backupIndex + 1,
        });
      }

      createdActivities.push({
        id: activity.id,
        priority: activity.priority,
        name: activity.name,
        activityType: activity.activityType,
        frequencyValue: activity.frequencyValue,
        frequencyUnit: activity.frequencyUnit,
        durationMinutes: activity.durationMinutes,
        allDay: activity.allDay,
        details: activity.details,
        location: activity.location,
        skippedAdjustment: activity.skippedAdjustment,
        supportsRemote: activity.supportsRemote,
        supportsInPerson: activity.supportsInPerson,
        staffIds: resolved.staff ? [resolved.staff.id] : [],
        staffNames: resolved.staff ? [resolved.staff.name] : [],
        equipmentIds: resolved.equipment ? [resolved.equipment.id] : [],
        equipmentNames: resolved.equipment ? [resolved.equipment.name] : [],
        metricLabels: metrics.map((metric) => `${metric.name} (${metric.unit})`),
        preparationLabels: preparation.map((task) => `${task.name} (${task.durationMinutes} min)`),
      });
    }

    await tx
      .update(users)
      .set({ scheduleStatus: "NO_SCHEDULE", updatedAt: new Date() })
      .where(eq(users.id, clientId));
  });

  return createdActivities;
}

export async function saveGeneratedActivityAction({
  clientId,
  activity: suggestedActivity,
}: {
  clientId: string;
  activity: ActionPlanActivitySuggestion;
}) {
  const parsed = actionPlanActivitySuggestionSchema.parse(suggestedActivity);
  let createdActivity: {
    id: string;
    priority: number;
    name: string;
    activityType: (typeof activityTypes)[number];
    frequencyValue: number;
    frequencyUnit: (typeof frequencyUnits)[number];
    durationMinutes: number;
    allDay: boolean;
    details: string;
    location: string | null;
    skippedAdjustment: string | null;
    supportsRemote: boolean | null;
    supportsInPerson: boolean | null;
    staffIds: string[];
    staffNames: string[];
    equipmentIds: string[];
    equipmentNames: string[];
    metricLabels: string[];
    preparationLabels: string[];
  } | null = null;

  await db.transaction(async (tx) => {
    const [currentPlan] = await tx
      .select()
      .from(actionPlans)
      .where(and(eq(actionPlans.clientId, clientId), eq(actionPlans.isCurrent, true)))
      .orderBy(desc(actionPlans.version))
      .limit(1);
    const plan = currentPlan ?? (await tx
      .insert(actionPlans)
      .values({
        clientId,
        version: 1,
        effectiveFrom: new Date(),
        isCurrent: true,
      })
      .returning())[0];

    if (!plan) {
      throw new Error("Unable to create action plan.");
    }

    const [staffRows, equipmentRows] = await Promise.all([
      tx
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(and(ne(users.role, "CLIENT"), ne(users.role, "ADMIN"))),
      tx
        .select({ id: equipment.id, name: equipment.name, type: equipment.type, location: equipment.location })
        .from(equipment),
    ]);
    const resolved = resolveGeneratedActivity({
      suggestedActivity: parsed,
      staffRows,
      equipmentRows,
      seed: `${clientId}-${parsed.name}`,
    });

    const [activity] = await tx
      .insert(activities)
      .values({
        actionPlanId: plan.id,
        ...resolved.activity,
      })
      .returning();

    if (resolved.staff) {
      await tx.insert(activityStaff).values({ activityId: activity.id, staffId: resolved.staff.id });
    }

    if (resolved.equipment) {
      await tx.insert(activityEquipment).values({ activityId: activity.id, equipmentId: resolved.equipment.id });
    }

    const metrics = resolved.metrics.map((name) => ({ activityId: activity.id, name, unit: "tracked" }));
    const preparation = resolved.preparationTasks.map((name) => ({
      activityId: activity.id,
      name,
      durationMinutes: 5,
    }));

    if (metrics.length > 0) {
      await tx.insert(activityMetrics).values(metrics);
    }

    if (preparation.length > 0) {
      await tx.insert(preparationTasks).values(preparation);
    }

    const backupNames = parsed.backupActivities
      .map((name) => name.trim())
      .filter(Boolean);

    for (const [backupIndex, backupName] of backupNames.entries()) {
      const [backupActivity] = await tx
        .insert(activities)
        .values(backupActivityValue({
          primary: activity,
          name: backupName,
          actionPlanId: plan.id,
          priorityOffset: backupIndex + 1,
        }))
        .returning();

      await tx.insert(activitySubstitutions).values({
        activityId: activity.id,
        substituteActivityId: backupActivity.id,
        priority: backupIndex + 1,
      });
    }

    await tx
      .update(users)
      .set({ scheduleStatus: "NO_SCHEDULE", updatedAt: new Date() })
      .where(eq(users.id, clientId));

    createdActivity = {
      id: activity.id,
      priority: activity.priority,
      name: activity.name,
      activityType: activity.activityType,
      frequencyValue: activity.frequencyValue,
      frequencyUnit: activity.frequencyUnit,
      durationMinutes: activity.durationMinutes,
      allDay: activity.allDay,
      details: activity.details,
      location: activity.location,
      skippedAdjustment: activity.skippedAdjustment,
      supportsRemote: activity.supportsRemote,
      supportsInPerson: activity.supportsInPerson,
      staffIds: resolved.staff ? [resolved.staff.id] : [],
      staffNames: resolved.staff ? [resolved.staff.name] : [],
      equipmentIds: resolved.equipment ? [resolved.equipment.id] : [],
      equipmentNames: resolved.equipment ? [resolved.equipment.name] : [],
      metricLabels: metrics.map((metric) => `${metric.name} (${metric.unit})`),
      preparationLabels: preparation.map((task) => `${task.name} (${task.durationMinutes} min)`),
    };
  });

  revalidatePath("/");

  if (!createdActivity) {
    throw new Error("Unable to save generated activity.");
  }

  return createdActivity;
}

export async function saveGeneratedActionPlanAction({
  clientId,
  activities: suggestedActivities,
}: {
  clientId: string;
  activities: ActionPlanActivitySuggestion[];
}) {
  const activities = await replaceActionPlanWithSuggestedActivities(clientId, suggestedActivities);
  revalidatePath("/");
  return { ok: true, activities };
}

export async function generateScheduleAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Schedule generated.";
  let toastType: ToastType = "success";

  try {
    const clientId = textValue(formData, "clientId");
    const effectiveDate = optionalTextValue(formData, "effectiveDate");
    const horizonDays = scheduleHorizonValue(formData);

    target = clientCalendarRedirect(redirectTarget(formData, `/?tab=clients&clientId=${clientId}`), clientId);
    const effectiveFrom = effectiveDate ? parseLocalDateTime(effectiveDate, "00:00") : new Date();

    if (startOfLocalDay(effectiveFrom) < startOfLocalDay(new Date())) {
      throw new Error("Schedule start date cannot be in the past.");
    }

    await generateScheduleForClient({
      clientId,
      effectiveFrom,
      horizonDays,
    });
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to generate schedule.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function deleteEventAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Event deleted.";
  let toastType: ToastType = "success";

  try {
    const eventId = textValue(formData, "eventId");
    const deleteScope = optionalTextValue(formData, "deleteScope") || "single";
    const [eventSchedule] = await db
      .select({
        scheduleId: schedules.id,
        clientId: schedules.clientId,
        activityId: calendarEvents.activityId,
        title: calendarEvents.title,
        startTime: calendarEvents.startTime,
        endTime: calendarEvents.endTime,
        isManual: calendarEvents.isManual,
      })
      .from(calendarEvents)
      .innerJoin(schedules, eq(calendarEvents.scheduleId, schedules.id))
      .where(eq(calendarEvents.id, eventId))
      .limit(1);

    if (!eventSchedule) {
      throw new Error("Calendar event not found.");
    }

    if (deleteScope !== "single" && deleteScope !== "future") {
      throw new Error("Delete scope is invalid.");
    }

    target = clientCalendarRedirect(target, eventSchedule.clientId);

    if (deleteScope === "future") {
      const scheduleEvents = await db
        .select({
          id: calendarEvents.id,
          activityId: calendarEvents.activityId,
          title: calendarEvents.title,
          startTime: calendarEvents.startTime,
          endTime: calendarEvents.endTime,
          isManual: calendarEvents.isManual,
        })
        .from(calendarEvents)
        .where(eq(calendarEvents.scheduleId, eventSchedule.scheduleId));
      const excludedEventIds = scheduleEvents
        .filter((event) => {
          const isSameSeries = eventSchedule.activityId
            ? event.activityId === eventSchedule.activityId
            : event.isManual === eventSchedule.isManual && event.title === eventSchedule.title;
          const isSeriesPreparation =
            eventSchedule.activityId !== null &&
            event.activityId === null &&
            event.title === preparationTitleFor(eventSchedule.title) &&
            event.endTime >= eventSchedule.startTime;

          return (isSameSeries && event.startTime >= eventSchedule.startTime) || isSeriesPreparation;
        })
        .map((event) => event.id);

      await createScheduleVersion({
        clientId: eventSchedule.clientId,
        excludeEventIds: excludedEventIds.length > 0 ? excludedEventIds : [eventId],
        preserveStatus: true,
      });
      message = "Future matching events deleted.";
    } else {
      const scheduleEvents = await db
        .select({
          id: calendarEvents.id,
          activityId: calendarEvents.activityId,
          title: calendarEvents.title,
          endTime: calendarEvents.endTime,
        })
        .from(calendarEvents)
        .where(eq(calendarEvents.scheduleId, eventSchedule.scheduleId));
      const adjacentPrepId = scheduleEvents.find((event) =>
        isAdjacentPreparationEvent(event, eventSchedule.title, eventSchedule.startTime),
      )?.id;

      await createScheduleVersion({
        clientId: eventSchedule.clientId,
        excludeEventIds: adjacentPrepId ? [eventId, adjacentPrepId] : [eventId],
        preserveStatus: true,
      });
    }
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to delete event.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function editEventAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Event updated.";
  let toastType: ToastType = "success";

  try {
    const eventId = textValue(formData, "eventId");
    const title = textValue(formData, "title");
    const allDay = checkboxValue(formData, "allDay");
    const startDate = textValue(formData, "startDate");
    const notes = optionalTextValue(formData, "notes");
    const parsedDate = parseLocalDateTime(startDate, "00:00");
    const { startsAt: startTime, endsAt: endTime } = allDay
      ? {
        startsAt: parsedDate,
        endsAt: addLocalDays(parsedDate, 1),
      }
      : localTimeRangeOnOrAfterDate(parsedDate, textValue(formData, "startTime"), textValue(formData, "endTime"));

    const [eventSchedule] = await db
      .select({
        clientId: schedules.clientId,
        scheduleId: schedules.id,
        activityId: calendarEvents.activityId,
        originalTitle: calendarEvents.title,
        originalStartTime: calendarEvents.startTime,
        isManual: calendarEvents.isManual,
        blocksScheduling: calendarEvents.blocksScheduling,
        scheduleMode: calendarEvents.scheduleMode,
      })
      .from(calendarEvents)
      .innerJoin(schedules, eq(calendarEvents.scheduleId, schedules.id))
      .where(eq(calendarEvents.id, eventId))
      .limit(1);

    if (!eventSchedule) {
      throw new Error("Calendar event not found.");
    }

    target = clientCalendarRedirect(target, eventSchedule.clientId);
    const scheduleEvents = await db
      .select({
        id: calendarEvents.id,
        activityId: calendarEvents.activityId,
        title: calendarEvents.title,
        endTime: calendarEvents.endTime,
      })
      .from(calendarEvents)
      .where(eq(calendarEvents.scheduleId, eventSchedule.scheduleId));
    const adjacentPrepId = scheduleEvents.find((event) =>
      isAdjacentPreparationEvent(event, eventSchedule.originalTitle, eventSchedule.originalStartTime),
    )?.id;

    await validateEditedEventTime({
      eventId,
      ignoredEventIds: adjacentPrepId ? [adjacentPrepId] : [],
      clientId: eventSchedule.clientId,
      activityId: eventSchedule.activityId,
      blocksScheduling: eventSchedule.blocksScheduling,
      scheduleMode: eventSchedule.scheduleMode,
      startTime,
      endTime,
    });

    await createScheduleVersion({
      clientId: eventSchedule.clientId,
      excludeEventIds: adjacentPrepId ? [eventId, adjacentPrepId] : [eventId],
      appendEvent: (scheduleId) => ({
        scheduleId,
        activityId: eventSchedule.activityId,
        title,
        startTime,
        endTime,
        allDay,
        isManual: eventSchedule.isManual,
        blocksScheduling: eventSchedule.blocksScheduling,
        scheduleMode: eventSchedule.scheduleMode,
        notes,
      }),
      preserveStatus: true,
    });
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to update event.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function addActivityAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Activity added.";
  let toastType: ToastType = "success";

  try {
    const clientId = textValue(formData, "clientId");

    target = redirectTarget(formData, `/?tab=clients&clientId=${clientId}`);

    await createActionPlanVersion({
      clientId,
      appendActivity: (actionPlanId) => activityInsertFromForm(formData, actionPlanId),
      appendActivityResources: {
        staffIds: idListValue(formData, "staffIds"),
        equipmentIds: idListValue(formData, "equipmentIds"),
      },
    });
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to add activity.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function saveSuggestedActionPlanAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Action plan saved.";
  let toastType: ToastType = "success";

  try {
    const clientId = textValue(formData, "clientId");
    const activityIndexes = Array.from(formData.keys()).reduce((indexes, key) => {
      const match = /^activities\[(\d+)]\.name$/.exec(key);

      if (match) {
        indexes.add(Number(match[1]));
      }

      return indexes;
    }, new Set<number>());
    const sortedIndexes = Array.from(activityIndexes).sort((left, right) => left - right);

    target = redirectTarget(formData, `/?tab=clients&clientId=${clientId}`);

    if (sortedIndexes.length === 0) {
      throw new Error("At least one activity is required.");
    }

    await db.transaction(async (tx) => {
      const [currentPlan] = await tx
        .select()
        .from(actionPlans)
        .where(and(eq(actionPlans.clientId, clientId), eq(actionPlans.isCurrent, true)))
        .orderBy(desc(actionPlans.version))
        .limit(1);

      if (currentPlan) {
        await tx
          .update(actionPlans)
          .set({ isCurrent: false })
          .where(eq(actionPlans.id, currentPlan.id));
      }

      const [newPlan] = await tx
        .insert(actionPlans)
        .values({
          clientId,
          version: (currentPlan?.version ?? 0) + 1,
          effectiveFrom: new Date(),
          isCurrent: true,
        })
        .returning();

      for (const index of sortedIndexes) {
        const prefix = `activities[${index}]`;
        const [activity] = await tx
          .insert(activities)
          .values({
            actionPlanId: newPlan.id,
            priority: priorityValue(formData, `${prefix}.priority`),
            name: textValue(formData, `${prefix}.name`),
            activityType: enumValue(formData, `${prefix}.activityType`, activityTypes),
            frequencyValue: numberValue(formData, `${prefix}.frequencyValue`),
            frequencyUnit: enumValue(formData, `${prefix}.frequencyUnit`, frequencyUnits),
            durationMinutes: numberValue(formData, `${prefix}.durationMinutes`),
            details: textValue(formData, `${prefix}.details`),
            location: optionalTextValue(formData, `${prefix}.location`) || null,
            skippedAdjustment: optionalTextValue(formData, `${prefix}.skippedAdjustment`) || null,
            supportsRemote: checkboxValue(formData, `${prefix}.supportsRemote`),
            supportsInPerson: true,
            allDay: false,
          })
          .returning();
        const metrics = textArrayValue(formData, `${prefix}.metrics`).map((name) => ({
          activityId: activity.id,
          name,
          unit: "tracked",
        }));
        const preparation = textArrayValue(formData, `${prefix}.preparationTasks`).map((name) => ({
          activityId: activity.id,
          name,
          durationMinutes: 5,
        }));

        if (metrics.length > 0) {
          await tx.insert(activityMetrics).values(metrics);
        }

        if (preparation.length > 0) {
          await tx.insert(preparationTasks).values(preparation);
        }
      }

      await tx
        .update(users)
        .set({ scheduleStatus: "NO_SCHEDULE", updatedAt: new Date() })
        .where(eq(users.id, clientId));
    });
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to save action plan.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function editActivityAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Activity updated.";
  let toastType: ToastType = "success";

  try {
    const activityId = textValue(formData, "activityId");
    const clientId = textValue(formData, "clientId");

    target = redirectTarget(formData, `/?tab=clients&clientId=${clientId}`);

    await createActionPlanVersion({
      clientId,
      replaceActivity: {
        activityId,
        values: (actionPlanId) => activityInsertFromForm(formData, actionPlanId),
        staffIds: idListValue(formData, "staffIds"),
        equipmentIds: idListValue(formData, "equipmentIds"),
      },
    });
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to update activity.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function deleteActivityAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Activity deleted.";
  let toastType: ToastType = "success";

  try {
    const activityId = textValue(formData, "activityId");
    const clientId = textValue(formData, "clientId");

    target = redirectTarget(formData, `/?tab=clients&clientId=${clientId}`);

    await createActionPlanVersion({ clientId, excludeActivityId: activityId });
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to delete activity.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function blockStaffAvailabilityAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Staff availability updated.";
  let toastType: ToastType = "success";

  try {
    const staffId = textValue(formData, "staffId");
    const date = textValue(formData, "date");
    const { startsAt, endsAt } = localTimeRangeOnOrAfterDate(
      parseLocalDateTime(date, "00:00"),
      textValue(formData, "startTime"),
      textValue(formData, "endTime"),
    );

    target = redirectTarget(formData, `/?tab=staff&staffId=${staffId}`);

    await db.insert(availabilitySlots).values({
      userId: staffId,
      equipmentId: null,
      startsAt,
      endsAt,
      availabilityType: "UNAVAILABLE",
    });
    await markSchedulesInvalidForStaff(staffId);
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to update staff availability.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function blockEquipmentAvailabilityAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Equipment availability updated.";
  let toastType: ToastType = "success";

  try {
    const equipmentId = textValue(formData, "equipmentId");
    const date = textValue(formData, "date");
    const { startsAt, endsAt } = localTimeRangeOnOrAfterDate(
      parseLocalDateTime(date, "00:00"),
      textValue(formData, "startTime"),
      textValue(formData, "endTime"),
    );

    target = redirectTarget(formData, `/?tab=equipment&equipmentId=${equipmentId}`);

    await db.insert(availabilitySlots).values({
      userId: null,
      equipmentId,
      startsAt,
      endsAt,
      availabilityType: "UNAVAILABLE",
    });
    await markSchedulesInvalidForEquipment(equipmentId);
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to update equipment availability.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function saveAvailabilityPeriodAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Availability updated.";
  let toastType: ToastType = "success";

  try {
    const entityType = enumValue(formData, "entityType", availabilityEntityTypes);
    const entityId = textValue(formData, "entityId");
    const availabilityType = enumValue(formData, "availabilityType", availabilityTypes);
    const startTime = textValue(formData, "startTime");
    const endTime = textValue(formData, "endTime");
    const weekdays = weekdayValues(formData);
    const slotIds = csvValue(formData, "slotIds");
    const updateRelevantSchedules = formData.get("updateRelevantSchedules") !== "no";

    target = redirectTarget(formData);

    if (weekdays.length === 0) {
      throw new Error("Choose at least one day of the week.");
    }

    const baseDate = await availabilityBaseDate();
    const rows = availabilityRowsFromForm({
      entityType,
      entityId,
      baseDate,
      availabilityType,
      weekdays,
      startTime,
      endTime,
    });

    await db.transaction(async (tx) => {
      if (slotIds.length > 0) {
        await tx.delete(availabilitySlots).where(inArray(availabilitySlots.id, slotIds));
      }

      if (rows.length > 0) {
        await tx.insert(availabilitySlots).values(rows);
      }
    });

    await markAvailabilityOwnerChanged(entityType, entityId, updateRelevantSchedules);
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to update availability.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function saveUnavailableExceptionAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Unavailable exception saved.";
  let toastType: ToastType = "success";

  try {
    const entityType = enumValue(formData, "entityType", availabilityEntityTypes);
    const entityId = textValue(formData, "entityId");
    const slotIds = csvValue(formData, "slotIds");
    const startDate = textValue(formData, "startDate");
    const endDate = textValue(formData, "endDate");
    const allDay = checkboxValue(formData, "allDay");
    const updateRelevantSchedules = formData.get("updateRelevantSchedules") !== "no";

    target = redirectTarget(formData);

    const startsAt = allDay
      ? parseLocalDateTime(startDate, "00:00")
      : parseLocalDateTime(startDate, textValue(formData, "startTime"));
    const endsAt = allDay
      ? addLocalDays(parseLocalDateTime(endDate, "00:00"), 1)
      : parseLocalDateTime(endDate, textValue(formData, "endTime"));

    if (endsAt <= startsAt) {
      throw new Error("End date and time must be after the start.");
    }

    await db.transaction(async (tx) => {
      if (slotIds.length > 0) {
        await tx.delete(availabilitySlots).where(inArray(availabilitySlots.id, slotIds));
      }

      await tx.insert(availabilitySlots).values({
        userId: entityType === "user" ? entityId : null,
        equipmentId: entityType === "equipment" ? entityId : null,
        startsAt,
        endsAt,
        availabilityType: "UNAVAILABLE",
      });
    });

    await markAvailabilityOwnerChanged(entityType, entityId, updateRelevantSchedules);
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to save unavailable exception.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}

export async function deleteAvailabilityPeriodAction(formData: FormData) {
  let target = redirectTarget(formData);
  let message = "Availability period deleted.";
  let toastType: ToastType = "success";

  try {
    const entityType = enumValue(formData, "entityType", availabilityEntityTypes);
    const entityId = textValue(formData, "entityId");
    const slotIds = csvValue(formData, "slotIds");
    const updateRelevantSchedules = formData.get("updateRelevantSchedules") !== "no";

    target = redirectTarget(formData);

    if (slotIds.length === 0) {
      throw new Error("Availability period was not found.");
    }

    await db.delete(availabilitySlots).where(inArray(availabilitySlots.id, slotIds));
    await markAvailabilityOwnerChanged(entityType, entityId, updateRelevantSchedules);
  } catch (error) {
    toastType = "error";
    message = actionErrorMessage(error, "Unable to delete availability period.");
  }

  revalidatePath("/");
  redirect(redirectWithToast(target, message, toastType));
}
