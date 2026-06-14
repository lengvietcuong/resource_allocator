import { z } from "zod";

export const activityTypeSchema = z.enum([
  "FITNESS",
  "FOOD",
  "MEDICATION",
  "THERAPY",
  "CONSULTATION",
]);

export const frequencyUnitSchema = z.enum(["DAY", "WEEK", "MONTH", "YEAR"]);

export const actionPlanActivitySuggestionSchema = z.object({
  name: z.string().describe("Short activity name"),
  activityType: activityTypeSchema,
  priority: z.number().int().min(1).max(4).describe("Internal priority rank: 1 Critical, 2 High, 3 Medium, 4 Low"),
  frequencyValue: z.number().int().min(1).max(12),
  frequencyUnit: frequencyUnitSchema,
  durationMinutes: z.number().int().min(1).max(240),
  details: z.string(),
  facilitatorRole: z.string().nullable().describe("Best staff role, such as Trainer, Doctor, Dietitian, Physiotherapist, or Occupational therapist"),
  equipmentType: z.string().nullable().describe("Required equipment category, or null when no physical equipment is needed"),
  location: z.string().nullable().describe("Preferred location or context for the activity"),
  canBeRemote: z.boolean().nullable().describe("Whether the activity can be completed remotely"),
  preparationTasks: z.array(z.string()).describe("Concrete preparation tasks needed before the activity"),
  backupActivities: z.array(z.string()).describe("Short backup activities when the primary activity is missed"),
  skippedAdjustment: z.string().nullable().describe("How to adjust the plan when this activity is skipped"),
  metrics: z.array(z.string()).describe("Metrics to track completion, response, or outcomes"),
});

export const actionPlanSuggestionSchema = z.object({
  activities: z
    .array(actionPlanActivitySuggestionSchema)
    .min(6)
    .max(10),
});

export type ActionPlanSuggestion = z.infer<typeof actionPlanSuggestionSchema>;
export type ActionPlanActivitySuggestion = z.infer<typeof actionPlanActivitySuggestionSchema>;
