import { loadEnvConfig } from "@next/env";

import { sqlClient } from "../../lib/db";

loadEnvConfig(process.cwd());

const tables = [
  "schedule_dependencies",
  "unscheduled_activities",
  "calendar_events",
  "schedules",
  "availability_slots",
  "activity_substitutions",
  "activity_equipment",
  "activity_staff",
  "preparation_tasks",
  "activity_metrics",
  "activities",
  "action_plans",
  "equipment",
  "users",
];

const types = [
  "activity_type",
  "availability_type",
  "frequency_unit",
  "schedule_mode",
  "schedule_status",
  "user_role",
];

async function main() {
  try {
    await sqlClient.unsafe(
      `DROP TABLE IF EXISTS ${tables.map((table) => `"${table}"`).join(", ")} CASCADE`,
    );
    await sqlClient.unsafe(
      `DROP TYPE IF EXISTS ${types.map((type) => `"${type}"`).join(", ")} CASCADE`,
    );
  } finally {
    await sqlClient.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
