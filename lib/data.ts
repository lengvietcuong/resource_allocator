import { and, asc, desc, eq, gt, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  actionPlans,
  activities,
  activityEquipment,
  activityMetrics,
  activityStaff,
  availabilitySlots,
  calendarEvents,
  equipment,
  preparationTasks,
  schedules,
  unscheduledActivities,
  users,
  type Equipment as EquipmentRecord,
  type User,
} from "@/lib/db/schema";
import {
  affectedClientsForEquipment,
  affectedClientsForStaff,
} from "@/lib/scheduler/scheduler";

export type DashboardTab = "clients" | "staff" | "equipment";
export type ScheduleProgress = {
  scheduledCount: number;
  missedCount: number;
  percent: number;
};
export type ClientWithScheduleProgress = User & {
  scheduleProgress: ScheduleProgress | null;
};

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);

  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function dashboardRangeBounds() {
  const today = startOfDay(new Date());

  return {
    start: today,
    end: addDays(today, 90),
  };
}

export async function getDashboardData({
  clientId,
  staffId,
  equipmentId,
}: {
  clientId?: string;
  staffId?: string;
  equipmentId?: string;
}) {
  const bounds = dashboardRangeBounds();
  const [clientRows, staffRows, equipmentRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(eq(users.role, "CLIENT"))
      .orderBy(asc(users.id)),
    db
      .select()
      .from(users)
      .where(and(ne(users.role, "CLIENT"), ne(users.role, "ADMIN")))
      .orderBy(asc(users.role), asc(users.name)),
    db.select().from(equipment).orderBy(asc(equipment.type), asc(equipment.name)),
  ]);

  const scheduleProgressByClient = await getClientScheduleProgress(
    clientRows.map((client) => client.id),
  );
  const clients: ClientWithScheduleProgress[] = clientRows.map((client) => ({
    ...client,
    scheduleProgress: scheduleProgressByClient.get(client.id) ?? null,
  }));
  const selectedClient =
    clients.find((client) => client.id === clientId) ?? clients[0] ?? null;
  const selectedStaff = staffRows.find((staff) => staff.id === staffId) ?? staffRows[0] ?? null;
  const selectedEquipment =
    equipmentRows.find((item) => item.id === equipmentId) ?? equipmentRows[0] ?? null;

  const [clientDetail, staffDetail, equipmentDetail] = await Promise.all([
    selectedClient ? getClientDetail(selectedClient.id, staffRows, equipmentRows, bounds) : null,
    selectedStaff ? getStaffDetail(selectedStaff.id, bounds) : null,
    selectedEquipment ? getEquipmentDetail(selectedEquipment.id, bounds) : null,
  ]);

  return {
    clients,
    staff: staffRows,
    equipment: equipmentRows,
    selectedClient,
    selectedStaff,
    selectedEquipment,
    clientDetail,
    staffDetail,
    equipmentDetail,
  };
}

async function getClientScheduleProgress(clientIds: string[]) {
  const progressByClient = new Map<string, ScheduleProgress>();

  if (clientIds.length === 0) {
    return progressByClient;
  }

  const currentSchedules = await db
    .select({
      id: schedules.id,
      clientId: schedules.clientId,
    })
    .from(schedules)
    .where(and(inArray(schedules.clientId, clientIds), eq(schedules.isCurrent, true)));
  const scheduleIds = currentSchedules.map((schedule) => schedule.id);

  if (scheduleIds.length === 0) {
    return progressByClient;
  }

  const [scheduledRows, missedRows] = await Promise.all([
    db
      .select({
        scheduleId: calendarEvents.scheduleId,
        count: sql<number>`count(*)::int`,
      })
      .from(calendarEvents)
      .where(
        and(
          inArray(calendarEvents.scheduleId, scheduleIds),
          eq(calendarEvents.isManual, false),
          isNotNull(calendarEvents.activityId),
        ),
      )
      .groupBy(calendarEvents.scheduleId),
    db
      .select({
        scheduleId: unscheduledActivities.scheduleId,
        count: sql<number>`coalesce(sum(${unscheduledActivities.missedCount}), 0)::int`,
      })
      .from(unscheduledActivities)
      .where(inArray(unscheduledActivities.scheduleId, scheduleIds))
      .groupBy(unscheduledActivities.scheduleId),
  ]);
  const scheduledBySchedule = new Map(
    scheduledRows.map((row) => [row.scheduleId, Number(row.count)]),
  );
  const missedBySchedule = new Map(
    missedRows.map((row) => [row.scheduleId, Number(row.count)]),
  );

  for (const schedule of currentSchedules) {
    const scheduledCount = scheduledBySchedule.get(schedule.id) ?? 0;
    const missedCount = missedBySchedule.get(schedule.id) ?? 0;
    const total = scheduledCount + missedCount;

    if (total === 0) {
      continue;
    }

    progressByClient.set(schedule.clientId, {
      scheduledCount,
      missedCount,
      percent: Math.floor((scheduledCount / total) * 100),
    });
  }

  return progressByClient;
}

async function getClientDetail(
  clientId: string,
  staffRows: User[],
  equipmentRows: EquipmentRecord[],
  bounds: { start: Date; end: Date },
) {
  const [currentPlan] = await db
    .select()
    .from(actionPlans)
    .where(and(eq(actionPlans.clientId, clientId), eq(actionPlans.isCurrent, true)))
    .orderBy(desc(actionPlans.version))
    .limit(1);

  const [currentSchedule] = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.clientId, clientId), eq(schedules.isCurrent, true)))
    .orderBy(desc(schedules.version))
    .limit(1);

  const [planActivities, scheduleEvents, unscheduledRows, clientSlots] = await Promise.all([
    currentPlan
      ? db
          .select()
          .from(activities)
          .where(eq(activities.actionPlanId, currentPlan.id))
          .orderBy(asc(activities.priority), asc(activities.name))
      : Promise.resolve([]),
    currentSchedule
      ? db
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.scheduleId, currentSchedule.id),
              lt(calendarEvents.startTime, bounds.end),
              gt(calendarEvents.endTime, bounds.start),
            ),
          )
          .orderBy(asc(calendarEvents.startTime), asc(calendarEvents.title))
      : Promise.resolve([]),
    currentSchedule
      ? db
          .select()
          .from(unscheduledActivities)
          .where(eq(unscheduledActivities.scheduleId, currentSchedule.id))
          .orderBy(desc(unscheduledActivities.missedCount), asc(unscheduledActivities.title))
      : Promise.resolve([]),
    db
      .select()
      .from(availabilitySlots)
      .where(
        and(
          eq(availabilitySlots.userId, clientId),
          lt(availabilitySlots.startsAt, bounds.end),
          gt(availabilitySlots.endsAt, bounds.start),
        ),
      )
      .orderBy(asc(availabilitySlots.startsAt)),
  ]);

  const activityIds = planActivities.map((activity) => activity.id);
  const [staffLinks, equipmentLinks, metrics, preparation] =
    activityIds.length > 0
      ? await Promise.all([
          db.select().from(activityStaff).where(inArray(activityStaff.activityId, activityIds)),
          db
            .select()
            .from(activityEquipment)
            .where(inArray(activityEquipment.activityId, activityIds)),
          db.select().from(activityMetrics).where(inArray(activityMetrics.activityId, activityIds)),
          db
            .select()
            .from(preparationTasks)
            .where(inArray(preparationTasks.activityId, activityIds)),
        ])
      : [[], [], [], []];

  const staffNameById = new Map(staffRows.map((staff) => [staff.id, staff.name]));
  const equipmentNameById = new Map(equipmentRows.map((item) => [item.id, item.name]));
  const activityTypeById = new Map(
    planActivities.map((activity) => [activity.id, activity.activityType]),
  );
  const activityById = new Map(planActivities.map((activity) => [activity.id, activity]));
  const staffByActivity = new Map<string, string[]>();
  const staffIdsByActivity = new Map<string, string[]>();
  const equipmentByActivity = new Map<string, string[]>();
  const equipmentIdsByActivity = new Map<string, string[]>();
  const metricsByActivity = new Map<string, string[]>();
  const prepByActivity = new Map<string, string[]>();

  for (const link of staffLinks) {
    staffIdsByActivity.set(link.activityId, [
      ...(staffIdsByActivity.get(link.activityId) ?? []),
      link.staffId,
    ]);
    staffByActivity.set(link.activityId, [
      ...(staffByActivity.get(link.activityId) ?? []),
      staffNameById.get(link.staffId) ?? "Unknown staff",
    ]);
  }

  for (const link of equipmentLinks) {
    equipmentIdsByActivity.set(link.activityId, [
      ...(equipmentIdsByActivity.get(link.activityId) ?? []),
      link.equipmentId,
    ]);
    equipmentByActivity.set(link.activityId, [
      ...(equipmentByActivity.get(link.activityId) ?? []),
      equipmentNameById.get(link.equipmentId) ?? "Unknown equipment",
    ]);
  }

  for (const metric of metrics) {
    metricsByActivity.set(metric.activityId, [
      ...(metricsByActivity.get(metric.activityId) ?? []),
      `${metric.name} (${metric.unit})`,
    ]);
  }

  for (const task of preparation) {
    prepByActivity.set(task.activityId, [
      ...(prepByActivity.get(task.activityId) ?? []),
      `${task.name} (${task.durationMinutes} min)`,
    ]);
  }

  return {
    currentPlan,
    currentSchedule,
    activities: planActivities
      .filter((activity) => !activity.isBackup)
      .map((activity) => ({
        ...activity,
        staffIds: staffIdsByActivity.get(activity.id) ?? [],
        staffNames: staffByActivity.get(activity.id) ?? [],
        equipmentIds: equipmentIdsByActivity.get(activity.id) ?? [],
        equipmentNames: equipmentByActivity.get(activity.id) ?? [],
        metricLabels: metricsByActivity.get(activity.id) ?? [],
        preparationLabels: prepByActivity.get(activity.id) ?? [],
      })),
    events: scheduleEvents.map((event) => ({
      ...event,
      activityType: event.activityId ? activityTypeById.get(event.activityId) ?? null : null,
      activity: event.activityId ? activityById.get(event.activityId) ?? null : null,
      staffNames: event.activityId ? staffByActivity.get(event.activityId) ?? [] : [],
      equipmentNames: event.activityId ? equipmentByActivity.get(event.activityId) ?? [] : [],
      metricLabels: event.activityId ? metricsByActivity.get(event.activityId) ?? [] : [],
      preparationLabels: event.activityId ? prepByActivity.get(event.activityId) ?? [] : [],
    })),
    unscheduledActivities: unscheduledRows.map((row) => ({
      ...row,
      activity: row.activityId ? activityById.get(row.activityId) ?? null : null,
      staffIds: row.activityId ? staffIdsByActivity.get(row.activityId) ?? [] : [],
      staffNames: row.activityId ? staffByActivity.get(row.activityId) ?? [] : [],
      equipmentIds: row.activityId ? equipmentIdsByActivity.get(row.activityId) ?? [] : [],
      equipmentNames: row.activityId ? equipmentByActivity.get(row.activityId) ?? [] : [],
      metricLabels: row.activityId ? metricsByActivity.get(row.activityId) ?? [] : [],
      preparationLabels: row.activityId ? prepByActivity.get(row.activityId) ?? [] : [],
    })),
    slots: clientSlots,
  };
}

async function getStaffDetail(staffId: string, bounds: { start: Date; end: Date }) {
  const [slots, affectedClients, eventRows] = await Promise.all([
    db
      .select()
      .from(availabilitySlots)
      .where(
        and(
          eq(availabilitySlots.userId, staffId),
          lt(availabilitySlots.startsAt, bounds.end),
          gt(availabilitySlots.endsAt, bounds.start),
        ),
      )
      .orderBy(asc(availabilitySlots.startsAt)),
    affectedClientsForStaff(staffId),
    db
      .select({
        id: calendarEvents.id,
        activityId: activities.id,
        title: calendarEvents.title,
        startTime: calendarEvents.startTime,
        endTime: calendarEvents.endTime,
        allDay: calendarEvents.allDay,
        isManual: calendarEvents.isManual,
        blocksScheduling: calendarEvents.blocksScheduling,
        notes: calendarEvents.notes,
        activityType: activities.activityType,
        frequencyValue: activities.frequencyValue,
        frequencyUnit: activities.frequencyUnit,
        durationMinutes: activities.durationMinutes,
        location: activities.location,
        skippedAdjustment: activities.skippedAdjustment,
        supportsRemote: activities.supportsRemote,
        supportsInPerson: activities.supportsInPerson,
        details: activities.details,
        clientName: users.name,
      })
      .from(calendarEvents)
      .innerJoin(schedules, and(eq(calendarEvents.scheduleId, schedules.id), eq(schedules.isCurrent, true)))
      .innerJoin(activities, eq(calendarEvents.activityId, activities.id))
      .innerJoin(activityStaff, and(eq(activityStaff.activityId, activities.id), eq(activityStaff.staffId, staffId)))
      .innerJoin(users, eq(schedules.clientId, users.id))
      .where(and(lt(calendarEvents.startTime, bounds.end), gt(calendarEvents.endTime, bounds.start)))
      .orderBy(asc(calendarEvents.startTime), asc(users.name), asc(calendarEvents.title)),
  ]);

  const events = await enrichResourceEvents(eventRows);
  const progressByClient = await getClientScheduleProgress(affectedClients.map((client) => client.clientId));

  return {
    slots,
    affectedClients: affectedClients.map((client) => ({
      ...client,
      scheduleProgress: progressByClient.get(client.clientId) ?? null,
    })),
    events,
  };
}

async function getEquipmentDetail(equipmentId: string, bounds: { start: Date; end: Date }) {
  const [slots, affectedClients, eventRows] = await Promise.all([
    db
      .select()
      .from(availabilitySlots)
      .where(
        and(
          eq(availabilitySlots.equipmentId, equipmentId),
          lt(availabilitySlots.startsAt, bounds.end),
          gt(availabilitySlots.endsAt, bounds.start),
        ),
      )
      .orderBy(asc(availabilitySlots.startsAt)),
    affectedClientsForEquipment(equipmentId),
    db
      .select({
        id: calendarEvents.id,
        activityId: activities.id,
        title: calendarEvents.title,
        startTime: calendarEvents.startTime,
        endTime: calendarEvents.endTime,
        allDay: calendarEvents.allDay,
        isManual: calendarEvents.isManual,
        blocksScheduling: calendarEvents.blocksScheduling,
        notes: calendarEvents.notes,
        activityType: activities.activityType,
        frequencyValue: activities.frequencyValue,
        frequencyUnit: activities.frequencyUnit,
        durationMinutes: activities.durationMinutes,
        location: activities.location,
        skippedAdjustment: activities.skippedAdjustment,
        supportsRemote: activities.supportsRemote,
        supportsInPerson: activities.supportsInPerson,
        details: activities.details,
        clientName: users.name,
      })
      .from(calendarEvents)
      .innerJoin(schedules, and(eq(calendarEvents.scheduleId, schedules.id), eq(schedules.isCurrent, true)))
      .innerJoin(activities, eq(calendarEvents.activityId, activities.id))
      .innerJoin(activityEquipment, and(eq(activityEquipment.activityId, activities.id), eq(activityEquipment.equipmentId, equipmentId)))
      .innerJoin(users, eq(schedules.clientId, users.id))
      .where(and(lt(calendarEvents.startTime, bounds.end), gt(calendarEvents.endTime, bounds.start)))
      .orderBy(asc(calendarEvents.startTime), asc(users.name), asc(calendarEvents.title)),
  ]);

  const events = await enrichResourceEvents(eventRows);
  const progressByClient = await getClientScheduleProgress(affectedClients.map((client) => client.clientId));

  return {
    slots,
    affectedClients: affectedClients.map((client) => ({
      ...client,
      scheduleProgress: progressByClient.get(client.clientId) ?? null,
    })),
    events,
  };
}

async function enrichResourceEvents<
  T extends {
    activityId: string;
  },
>(eventRows: T[]) {
  const activityIds = dedupe(eventRows.map((event) => event.activityId));

  if (activityIds.length === 0) {
    return eventRows.map((event) => ({
      ...event,
      staffNames: [],
      equipmentNames: [],
      metricLabels: [],
      preparationLabels: [],
    }));
  }

  const [staffRows, equipmentRows, metrics, preparation] = await Promise.all([
    db
      .select({ activityId: activityStaff.activityId, name: users.name })
      .from(activityStaff)
      .innerJoin(users, eq(activityStaff.staffId, users.id))
      .where(inArray(activityStaff.activityId, activityIds)),
    db
      .select({ activityId: activityEquipment.activityId, name: equipment.name })
      .from(activityEquipment)
      .innerJoin(equipment, eq(activityEquipment.equipmentId, equipment.id))
      .where(inArray(activityEquipment.activityId, activityIds)),
    db.select().from(activityMetrics).where(inArray(activityMetrics.activityId, activityIds)),
    db.select().from(preparationTasks).where(inArray(preparationTasks.activityId, activityIds)),
  ]);
  const staffByActivity = new Map<string, string[]>();
  const equipmentByActivity = new Map<string, string[]>();
  const metricsByActivity = new Map<string, string[]>();
  const prepByActivity = new Map<string, string[]>();

  for (const row of staffRows) {
    staffByActivity.set(row.activityId, [...(staffByActivity.get(row.activityId) ?? []), row.name]);
  }

  for (const row of equipmentRows) {
    equipmentByActivity.set(row.activityId, [...(equipmentByActivity.get(row.activityId) ?? []), row.name]);
  }

  for (const metric of metrics) {
    metricsByActivity.set(metric.activityId, [...(metricsByActivity.get(metric.activityId) ?? []), `${metric.name} (${metric.unit})`]);
  }

  for (const task of preparation) {
    prepByActivity.set(task.activityId, [...(prepByActivity.get(task.activityId) ?? []), `${task.name} (${task.durationMinutes} min)`]);
  }

  return eventRows.map((event) => ({
    ...event,
    staffNames: staffByActivity.get(event.activityId) ?? [],
    equipmentNames: equipmentByActivity.get(event.activityId) ?? [],
    metricLabels: metricsByActivity.get(event.activityId) ?? [],
    preparationLabels: prepByActivity.get(event.activityId) ?? [],
  }));
}
