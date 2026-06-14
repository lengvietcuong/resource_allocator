import { groq, type GroqLanguageModelOptions } from "@ai-sdk/groq";
import { Output, streamText } from "ai";
import { z } from "zod";

import {
  actionPlanActivitySuggestionSchema,
  type ActionPlanSuggestion,
} from "@/lib/action-plan-suggestions";

const requestSchema = z.object({
  clientName: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
});

function starterDraft(clientName: string, description: string): ActionPlanSuggestion {
  const context = description.toLowerCase();
  const glucoseFocus = context.includes("glucose") || context.includes("prediabetic") || context.includes("metabolic");
  const stressFocus = context.includes("sleep") || context.includes("stress") || context.includes("hrv") || context.includes("burnout");

  return {
    activities: [
      {
        name: "Zone 2 aerobic base",
        activityType: "FITNESS",
        priority: 1,
        frequencyValue: 3,
        frequencyUnit: "WEEK",
        durationMinutes: 40,
        details: `Schedule low-intensity cardio for ${clientName} at conversational pace; keep effort easy enough to recover well the next day.`,
        facilitatorRole: "Trainer",
        equipmentType: "Treadmill or bike",
        location: "Performance suite or hotel gym",
        canBeRemote: true,
        preparationTasks: ["Confirm shoes and heart-rate tracker", "Reserve cardio equipment when in clinic"],
        backupActivities: ["30-minute brisk outdoor walk"],
        skippedAdjustment: "Add one 25-minute walk within 48 hours instead of doubling the next session.",
        metrics: ["Average heart rate", "Session RPE", "Minutes completed"],
      },
      {
        name: "Progressive strength session",
        activityType: "FITNESS",
        priority: 2,
        frequencyValue: 2,
        frequencyUnit: "WEEK",
        durationMinutes: 50,
        details: "Use compound movement patterns with conservative loading, prioritizing consistency and joint-safe progression.",
        facilitatorRole: "Trainer",
        equipmentType: "Strength rack or dumbbells",
        location: "Performance suite",
        canBeRemote: false,
        preparationTasks: ["Reserve rack or dumbbells", "Review last session loads"],
        backupActivities: ["Bodyweight circuit with tempo squats, rows, push-ups, and carries"],
        skippedAdjustment: "Run a 20-minute mobility and bodyweight session the next morning.",
        metrics: ["Top working set", "Grip strength", "Session RPE"],
      },
      {
        name: glucoseFocus ? "Protein-first glucose control" : "Protein-forward meal anchor",
        activityType: "FOOD",
        priority: 2,
        frequencyValue: 1,
        frequencyUnit: "DAY",
        durationMinutes: 10,
        details: glucoseFocus
          ? "Anchor the first meal with 35-45g protein and fiber before starches to reduce glucose excursions."
          : "Anchor the first meal with 35-45g protein to stabilize appetite, training recovery, and executive energy.",
        facilitatorRole: "Dietitian",
        equipmentType: null,
        location: "Home, hotel, or office",
        canBeRemote: true,
        preparationTasks: ["Confirm breakfast option the night before", "Prepare a travel-safe protein backup"],
        backupActivities: ["Protein shake plus nuts or Greek yogurt"],
        skippedAdjustment: "Prioritize protein at the next meal and avoid compensatory snacking.",
        metrics: ["Protein grams", glucoseFocus ? "Post-meal glucose" : "Meal adherence"],
      },
      {
        name: stressFocus ? "Sleep regularity reset" : "Daily recovery downshift",
        activityType: "THERAPY",
        priority: 3,
        frequencyValue: 5,
        frequencyUnit: "WEEK",
        durationMinutes: 20,
        details: stressFocus
          ? "Protect a consistent wind-down window with dim light, device cutoff, and breathwork to improve sleep timing."
          : "Use breathwork, mobility, or sauna-style recovery to downshift after high-demand work blocks.",
        facilitatorRole: "Occupational therapist",
        equipmentType: null,
        location: "Home or hotel room",
        canBeRemote: true,
        preparationTasks: ["Block the calendar before evening commitments", "Set phone focus mode"],
        backupActivities: ["Five-minute box breathing protocol"],
        skippedAdjustment: "Do the five-minute backup before bed; do not extend bedtime to compensate.",
        metrics: ["Bedtime consistency", "HRV", "Sleep duration"],
      },
      {
        name: "Clinician protocol review",
        activityType: "CONSULTATION",
        priority: 3,
        frequencyValue: 2,
        frequencyUnit: "MONTH",
        durationMinutes: 45,
        details: "Review adherence, symptoms, biomarker priorities, medications or supplements, and schedule friction points.",
        facilitatorRole: "Doctor",
        equipmentType: "Telehealth booth",
        location: "Clinic or remote",
        canBeRemote: true,
        preparationTasks: ["Collect wearable summary", "List missed sessions and blockers"],
        backupActivities: ["Asynchronous note review with care team"],
        skippedAdjustment: "Send a concise update within 24 hours and reschedule within the same week.",
        metrics: ["Open clinical actions", "Adherence percentage", "Symptoms to monitor"],
      },
      {
        name: "Mobility micro-dose",
        activityType: "FITNESS",
        priority: 4,
        frequencyValue: 5,
        frequencyUnit: "WEEK",
        durationMinutes: 12,
        details: "Use a short hips, thoracic, neck, and shoulder reset to offset travel and desk posture load.",
        facilitatorRole: "Physiotherapist",
        equipmentType: null,
        location: "Anywhere",
        canBeRemote: true,
        preparationTasks: ["Place mobility band near work bag", "Pair with first calendar break"],
        backupActivities: ["Two-minute neck, hip, and breathing reset"],
        skippedAdjustment: "Do the two-minute backup before the next seated work block.",
        metrics: ["Pain score", "Mobility sessions completed"],
      },
    ],
  };
}

function streamFallback(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  fallback: ActionPlanSuggestion,
) {
  for (const activity of fallback.activities) {
    controller.enqueue(encoder.encode(`${JSON.stringify(activity)}\n`));
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response("Invalid request.", { status: 400 });
  }

  const fallback = starterDraft(parsed.data.clientName, parsed.data.description);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let streamedCount = 0;

      if (process.env.GROQ_API_KEY) {
        try {
          const result = streamText({
            model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
            temperature: 0.2,
            maxOutputTokens: 2600,
            output: Output.array({
              element: actionPlanActivitySuggestionSchema,
              name: "action_plan_activities",
              description: "Six to eight structured Elyx healthspan protocol activities.",
            }),
            providerOptions: {
              groq: {
                structuredOutputs: true,
                strictJsonSchema: true,
              } satisfies GroqLanguageModelOptions,
            },
            system:
              "You are an Elyx healthspan protocol assistant. Generate clinically sensible, practical longevity protocol activities for concierge members.",
            prompt: `Create a pragmatic first action plan for this client.

Client: ${parsed.data.clientName}
Health context: ${parsed.data.description}

Rules:
- Generate 6 to 8 activities.
- Prioritize high-impact basics first.
- Use priority ranks by label intent: 1 = Critical, 2 = High, 3 = Medium, 4 = Low.
- Use only valid enum values.
- Keep each details field concise but specific.
- Set facilitatorRole when a staff role is clinically or operationally useful.
- Set equipmentType only when a real physical or room resource is useful.
- Include practical preparation tasks, skipped adjustments, and measurable metrics.`,
          });

          for await (const activity of result.elementStream) {
            controller.enqueue(encoder.encode(`${JSON.stringify(activity)}\n`));
            streamedCount += 1;
          }
        } catch (error) {
          console.error("Activity suggestions failed", error);
        }
      }

      if (streamedCount === 0) {
        streamFallback(controller, encoder, fallback);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
