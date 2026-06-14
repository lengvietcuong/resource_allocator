import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "CLIENT",
  "TRAINER",
  "DOCTOR",
  "PHYSIOTHERAPIST",
  "DIETITIAN",
  "OCCUPATIONAL_THERAPIST",
  "SPEECH_THERAPIST",
  "ADMIN",
]);

export const scheduleStatusEnum = pgEnum("schedule_status", [
  "NO_ACTION_PLAN",
  "NO_SCHEDULE",
  "VALID",
  "INVALID",
]);

export const activityTypeEnum = pgEnum("activity_type", [
  "FITNESS",
  "FOOD",
  "MEDICATION",
  "THERAPY",
  "CONSULTATION",
]);

export const frequencyUnitEnum = pgEnum("frequency_unit", [
  "DAY",
  "WEEK",
  "MONTH",
  "YEAR",
]);

export const availabilityTypeEnum = pgEnum("availability_type", [
  "AVAILABLE",
  "UNAVAILABLE",
]);

export const scheduleModeEnum = pgEnum("schedule_mode", [
  "SELF_GUIDED",
  "REMOTE",
  "IN_PERSON",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    description: text("description").notNull(),
    avatarUrl: text("avatar_url"),
    role: userRoleEnum("role").notNull(),
    scheduleStatus: scheduleStatusEnum("schedule_status")
      .notNull()
      .default("NO_ACTION_PLAN"),
    dateJoined: timestamp("date_joined", { withTimezone: true }).notNull(),
    supportsRemote: boolean("supports_remote").notNull().default(false),
    supportsInPerson: boolean("supports_in_person").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_role_idx").on(table.role),
    index("users_schedule_status_idx").on(table.scheduleStatus),
  ],
);

export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    location: text("location").notNull(),
    description: text("description").notNull(),
    scheduleStatus: scheduleStatusEnum("schedule_status")
      .notNull()
      .default("VALID"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("equipment_type_idx").on(table.type),
    index("equipment_schedule_status_idx").on(table.scheduleStatus),
  ],
);

export const actionPlans = pgTable(
  "action_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("action_plans_client_idx").on(table.clientId),
    index("action_plans_current_idx").on(table.clientId, table.isCurrent),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionPlanId: uuid("action_plan_id")
      .notNull()
      .references(() => actionPlans.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull(),
    name: text("name").notNull(),
    activityType: activityTypeEnum("activity_type").notNull(),
    frequencyValue: integer("frequency_value").notNull(),
    frequencyUnit: frequencyUnitEnum("frequency_unit").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    details: text("details").notNull(),
    location: text("location"),
    skippedAdjustment: text("skipped_adjustment"),
    supportsRemote: boolean("supports_remote"),
    supportsInPerson: boolean("supports_in_person"),
    allDay: boolean("all_day").notNull().default(false),
    isBackup: boolean("is_backup").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("activities_plan_priority_idx").on(table.actionPlanId, table.priority),
    index("activities_type_idx").on(table.activityType),
  ],
);

export const activityMetrics = pgTable(
  "activity_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
  },
  (table) => [index("activity_metrics_activity_idx").on(table.activityId)],
);

export const preparationTasks = pgTable(
  "preparation_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
  },
  (table) => [index("preparation_tasks_activity_idx").on(table.activityId)],
);

export const activitySubstitutions = pgTable(
  "activity_substitutions",
  {
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    substituteActivityId: uuid("substitute_activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.activityId, table.substituteActivityId] }),
    index("activity_substitutions_activity_idx").on(table.activityId),
  ],
);

export const activityStaff = pgTable(
  "activity_staff",
  {
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.activityId, table.staffId] }),
    index("activity_staff_staff_idx").on(table.staffId),
  ],
);

export const activityEquipment = pgTable(
  "activity_equipment",
  {
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.activityId, table.equipmentId] }),
    index("activity_equipment_equipment_idx").on(table.equipmentId),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    status: scheduleStatusEnum("status").notNull().default("VALID"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("schedules_client_idx").on(table.clientId),
    index("schedules_current_idx").on(table.clientId, table.isCurrent),
  ],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").references(() => activities.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    scheduleMode: scheduleModeEnum("schedule_mode").notNull().default("IN_PERSON"),
    isManual: boolean("is_manual").notNull().default(false),
    blocksScheduling: boolean("blocks_scheduling").notNull().default(true),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    index("calendar_events_schedule_idx").on(table.scheduleId),
    index("calendar_events_time_idx").on(table.startTime, table.endTime),
    index("calendar_events_activity_idx").on(table.activityId),
  ],
);

export const unscheduledActivities = pgTable(
  "unscheduled_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").references(() => activities.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    missedCount: integer("missed_count").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("unscheduled_activities_schedule_idx").on(table.scheduleId),
    index("unscheduled_activities_activity_idx").on(table.activityId),
  ],
);

export const availabilitySlots = pgTable(
  "availability_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    equipmentId: uuid("equipment_id").references(() => equipment.id, {
      onDelete: "cascade",
    }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    availabilityType: availabilityTypeEnum("availability_type").notNull(),
  },
  (table) => [
    index("availability_user_idx").on(table.userId),
    index("availability_equipment_idx").on(table.equipmentId),
    index("availability_time_idx").on(table.startsAt, table.endsAt),
  ],
);

export const scheduleDependencies = pgTable(
  "schedule_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    equipmentId: uuid("equipment_id").references(() => equipment.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("schedule_dependencies_schedule_idx").on(table.scheduleId),
    index("schedule_dependencies_user_idx").on(table.userId),
    index("schedule_dependencies_equipment_idx").on(table.equipmentId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  actionPlans: many(actionPlans),
  schedules: many(schedules),
  availabilitySlots: many(availabilitySlots),
  staffedActivities: many(activityStaff),
  scheduleDependencies: many(scheduleDependencies),
}));

export const equipmentRelations = relations(equipment, ({ many }) => ({
  availabilitySlots: many(availabilitySlots),
  requiredByActivities: many(activityEquipment),
  scheduleDependencies: many(scheduleDependencies),
}));

export const actionPlansRelations = relations(actionPlans, ({ one, many }) => ({
  client: one(users, {
    fields: [actionPlans.clientId],
    references: [users.id],
  }),
  activities: many(activities),
}));

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  actionPlan: one(actionPlans, {
    fields: [activities.actionPlanId],
    references: [actionPlans.id],
  }),
  metrics: many(activityMetrics),
  preparationTasks: many(preparationTasks),
  staff: many(activityStaff),
  equipment: many(activityEquipment),
  calendarEvents: many(calendarEvents),
}));

export const activityMetricsRelations = relations(activityMetrics, ({ one }) => ({
  activity: one(activities, {
    fields: [activityMetrics.activityId],
    references: [activities.id],
  }),
}));

export const preparationTasksRelations = relations(preparationTasks, ({ one }) => ({
  activity: one(activities, {
    fields: [preparationTasks.activityId],
    references: [activities.id],
  }),
}));

export const activityStaffRelations = relations(activityStaff, ({ one }) => ({
  activity: one(activities, {
    fields: [activityStaff.activityId],
    references: [activities.id],
  }),
  staff: one(users, {
    fields: [activityStaff.staffId],
    references: [users.id],
  }),
}));

export const activityEquipmentRelations = relations(activityEquipment, ({ one }) => ({
  activity: one(activities, {
    fields: [activityEquipment.activityId],
    references: [activities.id],
  }),
  equipment: one(equipment, {
    fields: [activityEquipment.equipmentId],
    references: [equipment.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  client: one(users, {
    fields: [schedules.clientId],
    references: [users.id],
  }),
  events: many(calendarEvents),
  unscheduledActivities: many(unscheduledActivities),
  dependencies: many(scheduleDependencies),
}));

export const calendarEventsRelations = relations(calendarEvents, ({ one }) => ({
  schedule: one(schedules, {
    fields: [calendarEvents.scheduleId],
    references: [schedules.id],
  }),
  activity: one(activities, {
    fields: [calendarEvents.activityId],
    references: [activities.id],
  }),
}));

export const unscheduledActivitiesRelations = relations(unscheduledActivities, ({ one }) => ({
  schedule: one(schedules, {
    fields: [unscheduledActivities.scheduleId],
    references: [schedules.id],
  }),
  activity: one(activities, {
    fields: [unscheduledActivities.activityId],
    references: [activities.id],
  }),
}));

export const availabilitySlotsRelations = relations(availabilitySlots, ({ one }) => ({
  user: one(users, {
    fields: [availabilitySlots.userId],
    references: [users.id],
  }),
  equipment: one(equipment, {
    fields: [availabilitySlots.equipmentId],
    references: [equipment.id],
  }),
}));

export const scheduleDependenciesRelations = relations(
  scheduleDependencies,
  ({ one }) => ({
    schedule: one(schedules, {
      fields: [scheduleDependencies.scheduleId],
      references: [schedules.id],
    }),
    user: one(users, {
      fields: [scheduleDependencies.userId],
      references: [users.id],
    }),
    equipment: one(equipment, {
      fields: [scheduleDependencies.equipmentId],
      references: [equipment.id],
    }),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Equipment = typeof equipment.$inferSelect;
export type NewEquipment = typeof equipment.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type ActionPlan = typeof actionPlans.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type UnscheduledActivity = typeof unscheduledActivities.$inferSelect;
export type AvailabilitySlot = typeof availabilitySlots.$inferSelect;
