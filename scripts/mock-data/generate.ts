import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";

import { db, sqlClient } from "../../lib/db";
import * as schema from "../../lib/db/schema";
import { generateScheduleForClient } from "../../lib/scheduler/scheduler";

loadEnvConfig(process.cwd());

const SEED = "elyx-resource-allocator-v1";
const BASE_DATE = startOfToday();
const HORIZON_DAYS = 90;

type UserRole = (typeof schema.userRoleEnum.enumValues)[number];
type ActivityType = (typeof schema.activityTypeEnum.enumValues)[number];
type FrequencyUnit = (typeof schema.frequencyUnitEnum.enumValues)[number];
type NewUser = typeof schema.users.$inferInsert;
type NewEquipment = typeof schema.equipment.$inferInsert;
type NewActionPlan = typeof schema.actionPlans.$inferInsert;
type NewActivity = typeof schema.activities.$inferInsert;
type NewAvailabilitySlot = typeof schema.availabilitySlots.$inferInsert;
type NewCalendarEvent = typeof schema.calendarEvents.$inferInsert;

function startOfToday() {
  const now = new Date();

  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function stableUuid(input: string) {
  const hex = createHash("sha256").update(`${SEED}:${input}`).digest("hex");
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function dateAt(dayOffset: number, hour: number, minute = 0) {
  return new Date(
    BASE_DATE.getFullYear(),
    BASE_DATE.getMonth(),
    BASE_DATE.getDate() + dayOffset,
    hour,
    minute,
  );
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function pick<T>(items: T[], index: number) {
  return items[index % items.length];
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

function staffMember(
  index: number,
  role: UserRole,
  name: string,
  description: string,
  remote = true,
): NewUser {
  return {
    id: stableUuid(`staff-${index}-${role}`),
    name,
    email: `${name.toLowerCase().replaceAll(" ", ".")}@elyx.life`,
    phone: `+65 8${String(1000000 + index * 13729).slice(0, 7)}`,
    description,
    avatarUrl: null,
    role,
    scheduleStatus: "VALID",
    dateJoined: new Date("2026-01-15T09:00:00+08:00"),
    supportsRemote: remote,
    supportsInPerson: true,
  };
}

const clientsWithoutActionPlans = new Set([1]);
const clientsWithoutSchedules = new Set([0]);
const intensiveScheduleClients = new Set([8]);

const clients: NewUser[] = [
  [
    "Aarav Mehta",
    "Founder splitting time between Singapore, Dubai, and London with little control over meal timing. HbA1c is in the prediabetic range, ApoB is elevated, and late calls are fragmenting sleep. He wants durable executive energy without an aggressive protocol that collapses during travel weeks.",
  ],
  [
    "Celeste Tan",
    "Private equity partner with mild hypertension, low HRV, and a recent DEXA showing lower-than-expected lean mass. She responds well to concise morning commitments but misses long sessions when deal activity spikes. The care team is prioritizing strength, blood-pressure control, and recovery routines that fit a board-heavy calendar.",
  ],
  [
    "Daniel Cho",
    "Family office principal with long sedentary work blocks, visceral fat risk, and recurring lumbar tightness after flights. He has good adherence when sessions are scheduled around fixed school-run windows. Current goals are glucose stability, back resilience, and enough aerobic work to improve resting heart rate.",
  ],
  [
    "Elena Rossi",
    "Luxury retail executive navigating menopause transition with disrupted sleep, higher central adiposity, and declining training consistency. Labs show stable glucose but worsening lipids, and she is concerned about preserving muscle while managing event dinners. She prefers in-person accountability for strength and remote nutrition support during market visits.",
  ],
  [
    "Farid Rahman",
    "Tech investor with elevated fasting glucose, inconsistent protein intake, and frequent red-eye flights between Singapore and San Francisco. He has high cognitive workload, heavy caffeine use, and a tendency to skip recovery when meetings overrun. The protocol needs metabolic guardrails, compact hotel-gym options, and clinician oversight for supplements.",
  ],
  [
    "Grace Wong",
    "Venture partner with persistent neck tension, low aerobic base, and a calendar packed with early calls into the US. She prefers concise in-clinic assessments and remote follow-through while travelling. The care team is emphasizing posture resilience, lipid management, and low-friction recovery practices.",
  ],
  [
    "Hiroshi Sato",
    "Regional CEO managing frequent Tokyo and Singapore travel with mild sleep apnea risk, elevated stress load, and inconsistent strength training. He adheres well when sessions are scheduled before strategy blocks. The program needs sleep regularity, cardiometabolic conditioning, and physician-led review of recovery markers.",
  ],
  [
    "Iris Lim",
    "Family office operator returning to structured exercise after a shoulder flare and a demanding caregiving period. She wants measurable strengthspan gains without provoking pain. The plan prioritizes physiotherapy, progressive loading, protein adequacy, and recovery routines that survive school-holiday weeks.",
  ],
  [
    "Julian Park",
    "Crypto fund founder with erratic meal timing, frequent event dinners, and high sympathetic load during market volatility. He is motivated by wearable trends but needs guardrails against overtraining. Current priorities are glucose stability, HRV recovery, and reliable clinician checkpoints.",
  ],
  [
    "Kavita Menon",
    "Board director with osteopenia risk, declining grip strength, and a preference for private mid-day appointments. She travels regionally but keeps predictable morning windows. Elyx is focusing on resistance training, body composition tracking, vitamin D adherence, and sustainable mobility work.",
  ],
].map(([name, description], index) => ({
  id: stableUuid(`client-${index}`),
  name,
  email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
  phone: `+65 9${String(3000000 + index * 21137).slice(0, 7)}`,
  description,
  avatarUrl: null,
  role: "CLIENT",
  scheduleStatus: clientsWithoutActionPlans.has(index) ? "NO_ACTION_PLAN" : "NO_SCHEDULE",
  dateJoined: addDays(BASE_DATE, -60 + index * 5),
  supportsRemote: true,
  supportsInPerson: true,
}));

const staff: NewUser[] = [
  staffMember(0, "TRAINER", "Marcus Lee", "Performance trainer specializing in Zone 2 conditioning and progressive strength blocks."),
  staffMember(1, "TRAINER", "Sofia Hart", "Strength coach with experience supporting high-travel executives and injury-aware programming."),
  staffMember(2, "TRAINER", "Ben Chua", "Movement specialist for efficient morning training and wearable-guided load management."),
  staffMember(3, "DOCTOR", "Dr Varun Reddy", "Medical and science lead for biomarker interpretation and protocol governance."),
  staffMember(4, "DOCTOR", "Dr Elaine Koh", "Preventive medicine physician focused on cardiometabolic risk and medications."),
  staffMember(5, "PHYSIOTHERAPIST", "Nadia Singh", "Physiotherapist for shoulder, knee, back, and travel-related mobility constraints."),
  staffMember(6, "PHYSIOTHERAPIST", "Owen Ng", "Rehab specialist integrating strength, mobility, and return-to-run progressions."),
  staffMember(7, "DIETITIAN", "Leah Tan", "Dietitian focused on glucose control, protein targets, and event/travel nutrition."),
  staffMember(8, "DIETITIAN", "Amir Patel", "Clinical nutrition lead for lipid management and high-adherence meal systems."),
  staffMember(9, "OCCUPATIONAL_THERAPIST", "Mei Yamamoto", "Occupational therapist optimizing work routines, ergonomics, and fatigue management."),
  staffMember(10, "SPEECH_THERAPIST", "Clara Ho", "Communication and cognitive performance coach supporting executive clarity and voice health."),
  staffMember(11, "TRAINER", "Rafael Costa", "Hybrid conditioning coach for hotel-gym sessions and remote travel workouts."),
  staffMember(12, "DOCTOR", "Dr Jian Fransen", "Research advisor translating longevity evidence into safe protocol adjustments."),
  staffMember(13, "DIETITIAN", "Anika Rao", "Dietitian for plant-forward, high-protein nutrition and supplement adherence."),
  staffMember(14, "PHYSIOTHERAPIST", "Theo Martin", "Physiotherapist for mobility micro-sessions and posture resilience."),
  staffMember(15, "TRAINER", "Olivia Chen", "Trainer focused on low-impact conditioning and strength foundations."),
];

const equipmentItems: NewEquipment[] = [
  ["Woodway Treadmill A", "Treadmill", "Raffles Arcade Performance Suite", "Curved treadmill used for Zone 2 conditioning, gait-aware warmups, and low-impact aerobic sessions when trainers need precise pace control."],
  ["Woodway Treadmill B", "Treadmill", "Raffles Arcade Performance Suite", "Secondary treadmill for interval sessions, overflow aerobic work, and travel-return protocols where members need a familiar setup."],
  ["VALD ForceDecks", "Performance Testing", "Assessment Room", "Force plate system used for jump profiling, asymmetry checks, and neuromuscular baselines before strength or return-to-run blocks."],
  ["Grip Strength Dynamometer", "Performance Testing", "Assessment Room", "Hand-grip testing device used during strengthspan reviews to track fatigue, recovery status, and long-term functional strength trends."],
  ["Infrared Sauna Room 1", "Sauna", "Biohack Lounge", "Private infrared sauna suite with cooldown space for heat exposure, recovery, and cardiovascular conditioning protocols."],
  ["Infrared Sauna Room 2", "Sauna", "Biohack Lounge", "Second sauna suite reserved for high-demand days, paired recovery blocks, and members who require private post-session cooldown time."],
  ["Red Light Panel A", "Red Light Therapy", "Biohack Lounge", "Full-body red and near-infrared photobiomodulation panel used for recovery, skin-health routines, and low-friction inflammation support."],
  ["Red Light Panel B", "Red Light Therapy", "Biohack Lounge", "Second red light therapy panel that supports parallel recovery sessions and short add-ons after training or physiotherapy."],
  ["HBOT Chamber", "Hyperbaric Therapy", "Biohack Lounge", "Hyperbaric oxygen chamber for medically supervised recovery sessions, requiring setup time, safety checks, and clinician approval."],
  ["Cold Plunge", "Cold Therapy", "Recovery Room", "Cold immersion tub used for contrast therapy, recovery education, and carefully timed autonomic downshift sessions."],
  ["Strength Rack A", "Strength", "Performance Suite", "Primary rack with barbell, plates, cable accessories, and space for coach-led compound strength programming."],
  ["Strength Rack B", "Strength", "Performance Suite", "Secondary strength station used for trainer-led sessions, modified loading plans, and concurrent member strength blocks."],
  ["InBody 970", "Body Composition", "Assessment Room", "Body composition scanner used for lean mass, visceral fat estimates, hydration context, and monthly progress conversations."],
  ["Phlebotomy Chair", "Blood Testing", "Clinical Room", "Clinical draw station for fasting biomarker panels, requiring pre-labeling, nurse setup, and post-draw recovery time."],
  ["Continuous Glucose Monitor Kit", "Wearable", "Clinical Room", "CGM kit inventory used for metabolic experiments, onboarding education, and remote nutrition feedback loops."],
  ["Recovery Massage Table", "Physiotherapy", "Treatment Room", "Adjustable treatment table for manual therapy, mobility assessments, soft-tissue recovery, and rehab progression sessions."],
  ["Neurocognitive Test Station", "Cognitive Testing", "Assessment Room", "Reaction-time and cognitive performance station used for executive-function baselines and fatigue-sensitive follow-up checks."],
  ["Private Telehealth Booth", "Consultation", "Member Lounge", "Quiet booth with reliable video setup for remote doctor, dietitian, and protocol-review consultations."],
].map(([name, type, location, description], index) => ({
  id: stableUuid(`equipment-${index}`),
  name,
  type,
  location,
  description,
  scheduleStatus: "VALID",
}));

function staffByRole(role: UserRole) {
  return staff.filter((member) => member.role === role);
}

function equipmentByType(type: string) {
  return equipmentItems.filter((item) => item.type === type);
}

const actionPlansData: NewActionPlan[] = [];
const activitiesData: NewActivity[] = [];
const activityStaffRows: (typeof schema.activityStaff.$inferInsert)[] = [];
const activityEquipmentRows: (typeof schema.activityEquipment.$inferInsert)[] = [];
const activityMetricRows: (typeof schema.activityMetrics.$inferInsert)[] = [];
const preparationRows: (typeof schema.preparationTasks.$inferInsert)[] = [];
const substitutionRows: (typeof schema.activitySubstitutions.$inferInsert)[] = [];

function addActivity({
  clientIndex,
  actionPlanId,
  key,
  priority,
  name,
  activityType,
  frequencyValue,
  frequencyUnit,
  durationMinutes,
  details,
  supportsRemote,
  supportsInPerson,
  allDay = false,
  location,
  skippedAdjustment,
  staffIds = [],
  equipmentIds = [],
  metrics = [],
  prep = [],
}: {
  clientIndex: number;
  actionPlanId: string;
  key: string;
  priority: number;
  name: string;
  activityType: ActivityType;
  frequencyValue: number;
  frequencyUnit: FrequencyUnit;
  durationMinutes: number;
  details: string;
  supportsRemote?: boolean;
  supportsInPerson?: boolean;
  allDay?: boolean;
  location?: string;
  skippedAdjustment?: string;
  staffIds?: string[];
  equipmentIds?: string[];
  metrics?: { name: string; unit: string }[];
  prep?: { name: string; durationMinutes: number }[];
}) {
  const activityId = stableUuid(`activity-${clientIndex}-${key}`);

  activitiesData.push({
    id: activityId,
    actionPlanId,
    priority,
    name,
    activityType,
    frequencyValue,
    frequencyUnit,
    durationMinutes,
    details,
    location,
    skippedAdjustment,
    supportsRemote,
    supportsInPerson,
    allDay,
  });

  for (const staffId of staffIds) {
    activityStaffRows.push({ activityId, staffId });
  }

  for (const equipmentId of equipmentIds) {
    activityEquipmentRows.push({ activityId, equipmentId });
  }

  for (const metric of metrics) {
    activityMetricRows.push({
      id: stableUuid(`metric-${activityId}-${metric.name}`),
      activityId,
      name: metric.name,
      unit: metric.unit,
    });
  }

  for (const task of prep) {
    preparationRows.push({
      id: stableUuid(`prep-${activityId}-${task.name}`),
      activityId,
      name: task.name,
      durationMinutes: task.durationMinutes,
    });
  }

  return activityId;
}

for (const [clientIndex, client] of clients.entries()) {
  if (clientsWithoutActionPlans.has(clientIndex)) {
    continue;
  }

  const actionPlanId = stableUuid(`action-plan-${clientIndex}-current`);
  const trainer = pick(staffByRole("TRAINER"), clientIndex).id!;
  const secondaryTrainer = pick(staffByRole("TRAINER"), clientIndex + 2).id!;
  const doctor = pick(staffByRole("DOCTOR"), clientIndex).id!;
  const dietitian = pick(staffByRole("DIETITIAN"), clientIndex).id!;
  const treadmill = pick(equipmentByType("Treadmill"), clientIndex).id!;
  const strengthRack = pick(equipmentByType("Strength"), clientIndex).id!;
  const sauna = pick(equipmentByType("Sauna"), clientIndex).id!;
  const redLight = pick(equipmentByType("Red Light Therapy"), clientIndex).id!;
  const hbot = pick(equipmentByType("Hyperbaric Therapy"), clientIndex).id!;
  const bloodTesting = pick(equipmentByType("Blood Testing"), clientIndex).id!;
  const bodyComposition = pick(equipmentByType("Body Composition"), clientIndex).id!;
  const neurocognitiveStation = pick(equipmentByType("Cognitive Testing"), clientIndex).id!;
  const lighterSchedule = !intensiveScheduleClients.has(clientIndex);

  actionPlansData.push({
    id: actionPlanId,
    clientId: client.id!,
    version: 1,
    effectiveFrom: BASE_DATE,
    isCurrent: true,
  });

  const zone2 = addActivity({
    clientIndex,
    actionPlanId,
    key: "zone2-run",
    priority: 1,
    name: "Zone 2 aerobic conditioning",
    activityType: "FITNESS",
    frequencyValue: lighterSchedule ? 1 : 2,
    frequencyUnit: "WEEK",
    durationMinutes: lighterSchedule ? 30 : 45,
    details: "Maintain nasal-breathing effort and heart rate between 120-140 BPM unless wearable recovery is low.",
    supportsRemote: lighterSchedule ? true : undefined,
    staffIds: lighterSchedule ? [] : [trainer],
    equipmentIds: lighterSchedule ? [] : [treadmill],
    metrics: [
      { name: "Average heart rate", unit: "bpm" },
      { name: "Session RPE", unit: "1-10" },
    ],
    prep: [{ name: "Wear HR strap and running shoes", durationMinutes: 5 }],
  });

  const strength = addActivity({
    clientIndex,
    actionPlanId,
    key: "strength",
    priority: 1,
    name: "Progressive strength training",
    activityType: "FITNESS",
    frequencyValue: lighterSchedule ? 1 : 2,
    frequencyUnit: "WEEK",
    durationMinutes: lighterSchedule ? 40 : 60,
    details: "Compound strength session targeting hinge, squat, push, pull, and loaded carry patterns.",
    supportsRemote: lighterSchedule ? true : undefined,
    staffIds: lighterSchedule ? [] : [secondaryTrainer],
    equipmentIds: lighterSchedule ? [] : [strengthRack],
    metrics: [
      { name: "Top set load", unit: "kg" },
      { name: "Grip strength", unit: "kg" },
    ],
    prep: [{ name: "Reserve rack and load first warm-up set", durationMinutes: 10 }],
  });

  const mobility = addActivity({
    clientIndex,
    actionPlanId,
    key: "mobility",
    priority: 2,
    name: "Mobility and pain-prevention reset",
    activityType: "FITNESS",
    frequencyValue: lighterSchedule ? 1 : 3,
    frequencyUnit: "WEEK",
    durationMinutes: lighterSchedule ? 10 : 20,
    details: "Hips, thoracic rotation, shoulder control, and breathing reset tailored to travel load.",
    supportsRemote: true,
    allDay: true,
    metrics: [{ name: "Pain score", unit: "0-10" }],
  });

  addActivity({
    clientIndex,
    actionPlanId,
    key: "protein-breakfast",
    priority: 2,
    name: "Protein-forward breakfast target",
    activityType: "FOOD",
    frequencyValue: 1,
    frequencyUnit: "DAY",
    durationMinutes: 10,
    details: "Hit 35-45g protein before the first work block; prefer Greek yogurt, eggs, tofu scramble, or prepared meal.",
    supportsRemote: true,
    allDay: true,
    metrics: [{ name: "Protein consumed", unit: "g" }],
    prep: [{ name: "Confirm breakfast option with concierge", durationMinutes: 5 }],
  });

  addActivity({
    clientIndex,
    actionPlanId,
    key: "glucose-check",
    priority: 2,
    name: "Post-meal glucose review",
    activityType: "MEDICATION",
    frequencyValue: lighterSchedule ? 1 : 2,
    frequencyUnit: "WEEK",
    durationMinutes: lighterSchedule ? 5 : 10,
    details: "Review CGM or finger-prick response two hours after the largest carbohydrate meal.",
    supportsRemote: true,
    metrics: [{ name: "Post-prandial glucose", unit: "mmol/L" }],
  });

  addActivity({
    clientIndex,
    actionPlanId,
    key: "omega3",
    priority: 3,
    name: "Omega-3 and vitamin D adherence",
    activityType: "MEDICATION",
    frequencyValue: 1,
    frequencyUnit: "DAY",
    durationMinutes: 5,
    details: "Take clinician-approved supplement pack with food; pause only if the physician updates the protocol.",
    supportsRemote: true,
    allDay: true,
    metrics: [{ name: "Dose taken", unit: "yes/no" }],
  });

  addActivity({
    clientIndex,
    actionPlanId,
    key: "sauna",
    priority: 3,
    name: "Infrared sauna recovery protocol",
    activityType: "THERAPY",
    frequencyValue: 1,
    frequencyUnit: lighterSchedule ? "MONTH" : "WEEK",
    durationMinutes: 35,
    details: "20-25 minutes heat exposure plus cooldown; skip when HRV is suppressed or travel dehydration is present.",
    equipmentIds: [sauna],
    metrics: [{ name: "Heat exposure", unit: "minutes" }],
    prep: [{ name: "Prepare sauna and electrolyte drink", durationMinutes: 10 }],
  });

  addActivity({
    clientIndex,
    actionPlanId,
    key: "red-light",
    priority: 4,
    name: "Red light therapy",
    activityType: "THERAPY",
    frequencyValue: lighterSchedule ? 1 : 2,
    frequencyUnit: lighterSchedule ? "MONTH" : "WEEK",
    durationMinutes: 20,
    details: "Full-body photobiomodulation focused on recovery, skin health, and perceived inflammation.",
    equipmentIds: [redLight],
    metrics: [{ name: "Recovery rating", unit: "1-10" }],
  });

  if (clientIndex === 7 || clientIndex === 8) {
    addActivity({
      clientIndex,
      actionPlanId,
      key: "hbot-recovery",
      priority: 3,
      name: "HBOT recovery protocol",
      activityType: "THERAPY",
      frequencyValue: 1,
      frequencyUnit: "WEEK",
      durationMinutes: 60,
      details: "Medically cleared hyperbaric oxygen session for recovery and cognitive freshness during high-load weeks.",
      equipmentIds: [hbot],
      metrics: [{ name: "Recovery score", unit: "1-10" }],
      prep: [{ name: "Confirm chamber safety checklist", durationMinutes: 10 }],
    });
  }

  addActivity({
    clientIndex,
    actionPlanId,
    key: "dietitian",
    priority: 2,
    name: "Dietitian protocol check-in",
    activityType: "CONSULTATION",
    frequencyValue: lighterSchedule ? 1 : 2,
    frequencyUnit: "MONTH",
    durationMinutes: 45,
    details: "Adjust meal architecture, travel defaults, protein target, and glucose response experiments.",
    supportsRemote: true,
    staffIds: [dietitian],
    metrics: [{ name: "Nutrition adherence", unit: "%" }],
  });

  addActivity({
    clientIndex,
    actionPlanId,
    key: "physician-review",
    priority: 1,
    name: "Physician biomarker review",
    activityType: "CONSULTATION",
    frequencyValue: 1,
    frequencyUnit: "MONTH",
    durationMinutes: 45,
    details: "Review cardiometabolic markers, medication safety, and protocol adjustments.",
    supportsRemote: true,
    staffIds: [doctor],
    metrics: [{ name: "Open clinical actions", unit: "count" }],
  });

  addActivity({
    clientIndex,
    actionPlanId,
    key: "blood-panel",
    priority: 2,
    name: "Monthly blood biomarker panel",
    activityType: "CONSULTATION",
    frequencyValue: 1,
    frequencyUnit: "MONTH",
    durationMinutes: 60,
    details: "Fasted draw for glucose, insulin, lipids, hsCRP, CBC, CMP, ferritin, vitamin D, and selected hormones.",
    equipmentIds: [bloodTesting],
    metrics: [
      { name: "Fasting glucose", unit: "mmol/L" },
      { name: "ApoB", unit: "mg/dL" },
    ],
    prep: [{ name: "Confirm fasting status and lab labels", durationMinutes: 10 }],
  });

  const walk = addActivity({
    clientIndex,
    actionPlanId,
    key: "recovery-walk",
    priority: 3,
    name: "Recovery walk and sunlight exposure",
    activityType: "FITNESS",
    frequencyValue: lighterSchedule ? 1 : 2,
    frequencyUnit: "WEEK",
    durationMinutes: lighterSchedule ? 20 : 30,
    details: "Outdoor walk at conversational pace with morning light exposure when available.",
    supportsRemote: true,
    allDay: true,
    metrics: [{ name: "Steps", unit: "count" }],
  });

  const bodyScan = addActivity({
    clientIndex,
    actionPlanId,
    key: "body-composition",
    priority: 4,
    name: "Body composition scan",
    activityType: "CONSULTATION",
    frequencyValue: 1,
    frequencyUnit: "MONTH",
    durationMinutes: 25,
    details: "Track lean mass, visceral fat estimate, and body water after consistent hydration conditions.",
    equipmentIds: [bodyComposition],
    metrics: [
      { name: "Lean mass", unit: "kg" },
      { name: "Visceral fat area", unit: "cm2" },
    ],
  });

  if (clientIndex === 8) {
    addActivity({
      clientIndex,
      actionPlanId,
      key: "neurocognitive-baseline",
      priority: 4,
      name: "Neurocognitive baseline",
      activityType: "CONSULTATION",
      frequencyValue: 1,
      frequencyUnit: "MONTH",
      durationMinutes: 45,
      details: "Monthly executive-function baseline using reaction-time and attention measures.",
      equipmentIds: [neurocognitiveStation],
      metrics: [
        { name: "Reaction time", unit: "ms" },
        { name: "Attention score", unit: "percentile" },
      ],
    });
  }

  substitutionRows.push(
    { activityId: zone2, substituteActivityId: walk, priority: 1 },
    { activityId: strength, substituteActivityId: mobility, priority: 1 },
    { activityId: "", substituteActivityId: bodyScan, priority: 4 },
  );
  substitutionRows.pop();
}

const availabilityData: NewAvailabilitySlot[] = [];

type AvailabilityWindow = {
  startHour: number;
  startMinute?: number;
  endHour: number;
  endMinute?: number;
};

type WeeklyAvailabilityPattern = Partial<Record<number, AvailabilityWindow[]>>;

type BlockedPeriod = {
  key: string;
  startDay: number;
  startHour: number;
  endDay: number;
  endHour: number;
  startMinute?: number;
  endMinute?: number;
};

function addAvailabilityRow(row: NewAvailabilitySlot) {
  if (row.endsAt <= BASE_DATE) {
    return;
  }

  availabilityData.push({
    ...row,
    startsAt: row.startsAt < BASE_DATE ? BASE_DATE : row.startsAt,
  });
}

function addUserAvailability(
  userId: string,
  day: number,
  startHour: number,
  endHour: number,
  type: "AVAILABLE" | "UNAVAILABLE" = "AVAILABLE",
  startMinute = 0,
  endMinute = 0,
) {
  addAvailabilityRow({
    id: stableUuid(`availability-user-${userId}-${day}-${startHour}-${startMinute}-${endHour}-${endMinute}-${type}`),
    userId,
    equipmentId: null,
    startsAt: dateAt(day, startHour, startMinute),
    endsAt: dateAt(day, endHour, endMinute),
    availabilityType: type,
  });
}

function addEquipmentAvailability(
  equipmentId: string,
  day: number,
  startHour: number,
  endHour: number,
  type: "AVAILABLE" | "UNAVAILABLE" = "AVAILABLE",
  startMinute = 0,
  endMinute = 0,
) {
  addAvailabilityRow({
    id: stableUuid(`availability-equipment-${equipmentId}-${day}-${startHour}-${startMinute}-${endHour}-${endMinute}-${type}`),
    userId: null,
    equipmentId,
    startsAt: dateAt(day, startHour, startMinute),
    endsAt: dateAt(day, endHour, endMinute),
    availabilityType: type,
  });
}

function addUserWindow(
  userId: string,
  day: number,
  window: AvailabilityWindow,
  type: "AVAILABLE" | "UNAVAILABLE" = "AVAILABLE",
) {
  addUserAvailability(
    userId,
    day,
    window.startHour,
    window.endHour,
    type,
    window.startMinute ?? 0,
    window.endMinute ?? 0,
  );
}

function addEquipmentWindow(
  equipmentId: string,
  day: number,
  window: AvailabilityWindow,
  type: "AVAILABLE" | "UNAVAILABLE" = "AVAILABLE",
) {
  addEquipmentAvailability(
    equipmentId,
    day,
    window.startHour,
    window.endHour,
    type,
    window.startMinute ?? 0,
    window.endMinute ?? 0,
  );
}

function addUserBlockedPeriod(userId: string, period: BlockedPeriod) {
  addAvailabilityRow({
    id: stableUuid(`availability-user-blocked-${userId}-${period.key}`),
    userId,
    equipmentId: null,
    startsAt: dateAt(period.startDay, period.startHour, period.startMinute ?? 0),
    endsAt: dateAt(period.endDay, period.endHour, period.endMinute ?? 0),
    availabilityType: "UNAVAILABLE",
  });
}

function addEquipmentBlockedPeriod(equipmentId: string, period: BlockedPeriod) {
  addAvailabilityRow({
    id: stableUuid(`availability-equipment-blocked-${equipmentId}-${period.key}`),
    userId: null,
    equipmentId,
    startsAt: dateAt(period.startDay, period.startHour, period.startMinute ?? 0),
    endsAt: dateAt(period.endDay, period.endHour, period.endMinute ?? 0),
    availabilityType: "UNAVAILABLE",
  });
}

function clientWeeklyPattern(clientIndex: number): WeeklyAvailabilityPattern {
  const morningStart = clientIndex % 2 === 0 ? 7 : 8;
  const afternoonStart = clientIndex % 3 === 0 ? 15 : 16;
  const weekdayWindows = [
    { startHour: morningStart, endHour: 11 },
    { startHour: afternoonStart, endHour: 19 },
  ];

  return {
    1: weekdayWindows,
    2: weekdayWindows,
    3: weekdayWindows,
    4: weekdayWindows,
    5: weekdayWindows,
    6: [{ startHour: 9, endHour: 12 }],
  };
}

function clientBlockedPeriods(clientIndex: number): BlockedPeriod[] {
  if (![0, 3, 6, 8].includes(clientIndex)) {
    return [];
  }

  const startDay = 18 + clientIndex * 4;

  return [{
    key: `time-off-${clientIndex}`,
    startDay,
    startHour: 0,
    endDay: startDay + 2,
    endHour: 0,
  }];
}

const clientAvailabilityPatterns: {
  weekly: WeeklyAvailabilityPattern;
  blocked: BlockedPeriod[];
}[] = clients.map((_, clientIndex) => ({
  weekly: clientWeeklyPattern(clientIndex),
  blocked: clientBlockedPeriods(clientIndex),
}));
function staffAvailabilityWindows(member: NewUser, staffIndex: number, weekday: number): AvailabilityWindow[] {
  if (member.role === "TRAINER") {
    if (weekday === 0) {
      return [];
    }

    if (weekday === 6) {
      return staffIndex % 2 === 0
        ? [{ startHour: 7, endHour: 12 }]
        : [{ startHour: 10, endHour: 15 }];
    }

    return staffIndex % 2 === 0
      ? [{ startHour: 6, endHour: 14 }]
      : [{ startHour: 12, endHour: 20 }];
  }

  if (weekday < 1 || weekday > 5) {
    return [];
  }

  if (member.role === "DOCTOR") {
    return [{ startHour: 8, endHour: 20 }];
  }

  if (member.role === "PHYSIOTHERAPIST") {
    return weekday === 2 || weekday === 4
      ? [{ startHour: 10, endHour: 18 }]
      : [{ startHour: 8, endHour: 16 }];
  }

  if (member.role === "DIETITIAN") {
    return weekday === 5
      ? [{ startHour: 9, endHour: 15 }]
      : [{ startHour: 9, endHour: 18 }];
  }

  return weekday <= 4 ? [{ startHour: 10, endHour: 17 }] : [];
}

function equipmentAvailabilityWindows(item: NewEquipment, weekday: number): AvailabilityWindow[] {
  if (item.type === "Blood Testing") {
    return weekday >= 1 && weekday <= 5 ? [{ startHour: 7, startMinute: 30, endHour: 15, endMinute: 30 }] : [];
  }

  if (item.type === "Body Composition" || item.type === "Performance Testing") {
    if (weekday >= 1 && weekday <= 5) {
      return [{ startHour: 8, endHour: 17 }];
    }

    return weekday === 6 ? [{ startHour: 9, endHour: 13 }] : [];
  }

  if (item.type === "Hyperbaric Therapy") {
    return weekday >= 1 && weekday <= 5 ? [{ startHour: 9, endHour: 18 }] : [];
  }

  if (item.type === "Consultation") {
    return weekday >= 1 && weekday <= 5
      ? [{ startHour: 7, endHour: 21 }]
      : [{ startHour: 8, endHour: 16 }];
  }

  return [{ startHour: 6, endHour: 21 }];
}

function weekOfMonth(day: Date) {
  return Math.floor((day.getDate() - 1) / 7) + 1;
}

function clientRoutineBlockedWindow(_clientIndex: number, _day: Date): AvailabilityWindow | null {
  return null;
}

function staffRoutineBlockedWindow(_member: NewUser, _staffIndex: number, _day: Date): AvailabilityWindow | null {
  return null;
}

function equipmentRoutineBlockedWindow(_item: NewEquipment, _day: Date): AvailabilityWindow | null {
  return null;
}

for (let day = 0; day < HORIZON_DAYS; day += 1) {
  const current = dateAt(day, 0);
  const weekday = current.getDay();

  for (const [clientIndex, client] of clients.entries()) {
    for (const window of clientAvailabilityPatterns[clientIndex].weekly[weekday] ?? []) {
      addUserWindow(client.id!, day, window);
    }

    const blockedWindow = clientRoutineBlockedWindow(clientIndex, current);

    if (blockedWindow) {
      addUserWindow(client.id!, day, blockedWindow, "UNAVAILABLE");
    }
  }

  for (const [staffIndex, member] of staff.entries()) {
    for (const window of staffAvailabilityWindows(member, staffIndex, weekday)) {
      addUserWindow(member.id!, day, window);
    }

    const blockedWindow = staffRoutineBlockedWindow(member, staffIndex, current);

    if (blockedWindow) {
      addUserWindow(member.id!, day, blockedWindow, "UNAVAILABLE");
    }
  }

  for (const [equipmentIndex, item] of equipmentItems.entries()) {
    for (const window of equipmentAvailabilityWindows(item, weekday)) {
      addEquipmentWindow(item.id!, day, window);
    }

    const blockedWindow = equipmentRoutineBlockedWindow(item, current);

    if (blockedWindow) {
      addEquipmentWindow(item.id!, day, blockedWindow, "UNAVAILABLE");
    }
  }
}

for (const [clientIndex, client] of clients.entries()) {
  for (const period of clientAvailabilityPatterns[clientIndex].blocked) {
    addUserBlockedPeriod(client.id!, period);
  }
}

for (const [staffIndex, member] of staff.entries()) {
  if (staffIndex >= 3) {
    continue;
  }

  addUserBlockedPeriod(member.id!, {
    key: `training-day-${staffIndex}`,
    startDay: 28 + staffIndex * 7,
    startHour: 0,
    endDay: 29 + staffIndex * 7,
    endHour: 0,
  });
}

for (const [equipmentIndex, item] of equipmentItems.entries()) {
  if (!["Performance Testing", "Blood Testing"].includes(item.type)) {
    continue;
  }

  addEquipmentBlockedPeriod(item.id!, {
    key: `maintenance-${equipmentIndex}`,
    startDay: 62 + equipmentIndex,
    startHour: 9,
    endDay: 62 + equipmentIndex,
    endHour: 12,
  });
}

addEquipmentBlockedPeriod(pick(equipmentByType("Cognitive Testing"), 8).id!, {
  key: "neurocognitive-station-upgrade",
  startDay: 0,
  startHour: 0,
  endDay: HORIZON_DAYS,
  endHour: 0,
});

const manualSchedules: (typeof schema.schedules.$inferInsert)[] = [];
const manualEvents: NewCalendarEvent[] = [];
const travelCities = ["London", "Dubai", "Tokyo", "Sydney", "Zurich", "Jakarta"];

for (const [clientIndex, client] of clients.entries()) {
  if (clientsWithoutActionPlans.has(clientIndex) || clientsWithoutSchedules.has(clientIndex)) {
    continue;
  }

  const scheduleId = stableUuid(`manual-schedule-${clientIndex}`);
  const firstTravelDay = 8 + clientIndex * 3;
  const secondTravelDay = 48 + clientIndex;
  const blocksManualScheduling = clientIndex === 8;

  manualSchedules.push({
    id: scheduleId,
    clientId: client.id!,
    version: 1,
    effectiveFrom: BASE_DATE,
    status: "VALID",
    isCurrent: true,
  });

  for (const [tripIndex, startDay] of [firstTravelDay, secondTravelDay].entries()) {
    const start = dateAt(startDay, 0);
    const end = addDays(start, 3 + ((clientIndex + tripIndex) % 3));

    manualEvents.push({
      id: stableUuid(`travel-${clientIndex}-${tripIndex}`),
      scheduleId,
      activityId: null,
      title: `Travel: ${pick(travelCities, clientIndex + tripIndex)}`,
      startTime: start,
      endTime: end,
      allDay: true,
      scheduleMode: "SELF_GUIDED",
      isManual: true,
      blocksScheduling: blocksManualScheduling,
      notes: blocksManualScheduling
        ? "Travel plan; blocks scheduling unless the care team adjusts the protocol."
        : "Travel note for concierge awareness; schedule remains feasible around this trip.",
    });
  }

}

async function resetDatabase() {
  await db.delete(schema.scheduleDependencies);
  await db.delete(schema.unscheduledActivities);
  await db.delete(schema.calendarEvents);
  await db.delete(schema.schedules);
  await db.delete(schema.availabilitySlots);
  await db.delete(schema.activitySubstitutions);
  await db.delete(schema.activityEquipment);
  await db.delete(schema.activityStaff);
  await db.delete(schema.preparationTasks);
  await db.delete(schema.activityMetrics);
  await db.delete(schema.activities);
  await db.delete(schema.actionPlans);
  await db.delete(schema.equipment);
  await db.delete(schema.users);
}

async function insertBatches<T>(
  table: Parameters<typeof db.insert>[0],
  values: T[],
  size = 500,
) {
  for (const chunk of chunks(values, size)) {
    if (chunk.length > 0) {
      await db.insert(table).values(chunk as never[]);
    }
  }
}

async function main() {
  try {
    await resetDatabase();

    await insertBatches(schema.users, [...clients, ...staff]);
    await insertBatches(schema.equipment, equipmentItems);
    await insertBatches(schema.actionPlans, actionPlansData);
    await insertBatches(schema.activities, activitiesData);
    await insertBatches(schema.activityMetrics, activityMetricRows);
    await insertBatches(schema.preparationTasks, preparationRows);
    await insertBatches(schema.activityStaff, activityStaffRows);
    await insertBatches(schema.activityEquipment, activityEquipmentRows);
    await insertBatches(schema.activitySubstitutions, substitutionRows);
    await insertBatches(schema.availabilitySlots, availabilityData);
    await insertBatches(schema.schedules, manualSchedules);
    await insertBatches(schema.calendarEvents, manualEvents);

    const generatedSchedules = [];

    for (const [clientIndex, client] of clients.entries()) {
      if (clientsWithoutActionPlans.has(clientIndex) || clientsWithoutSchedules.has(clientIndex)) {
        continue;
      }

      generatedSchedules.push(
        await generateScheduleForClient({
          clientId: client.id!,
          effectiveFrom: BASE_DATE,
          horizonDays: HORIZON_DAYS,
        }),
      );
    }

    const affectedByStaff: { scheduleId: string; clientId: string; clientName: string }[] = [];
    const affectedByEquipment: { scheduleId: string; clientId: string; clientName: string }[] = [];

    for (const clientIndex of clientsWithoutActionPlans) {
      const client = clients[clientIndex];

      if (client?.id) {
        await db
          .update(schema.users)
          .set({ scheduleStatus: "NO_ACTION_PLAN", updatedAt: new Date() })
          .where(eq(schema.users.id, client.id));
      }
    }

    const generatedDir = join(process.cwd(), "scripts", "mock-data", "generated");

    await mkdir(generatedDir, { recursive: true });
    await writeFile(
      join(generatedDir, "mock-data.json"),
      JSON.stringify(
        {
          seed: SEED,
          baseDate: BASE_DATE.toISOString(),
          clients,
          staff,
          equipment: equipmentItems,
          actionPlans: actionPlansData,
          activities: activitiesData,
          activityStaff: activityStaffRows,
          activityEquipment: activityEquipmentRows,
          activityMetrics: activityMetricRows,
          preparationTasks: preparationRows,
          activitySubstitutions: substitutionRows,
          availabilitySlots: availabilityData,
          manualEvents,
          generatedSchedules,
          affectedByStaff,
          affectedByEquipment,
        },
        null,
        2,
      ),
    );

    console.log("Mock data generated.");
    console.log(`Clients: ${clients.length}`);
    console.log(`Staff: ${staff.length}`);
    console.log(`Equipment: ${equipmentItems.length}`);
    console.log(`Activities: ${activitiesData.length}`);
    console.log(`Availability slots: ${availabilityData.length}`);
    console.log(`Schedules generated: ${generatedSchedules.length}`);
  } finally {
    await sqlClient.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
