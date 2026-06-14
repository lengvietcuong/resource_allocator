"use client";

import { Sparkles, WandSparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { saveGeneratedActivityAction } from "@/app/actions/resource-allocator";
import {
  ActionPlanActivityCardSkeletonGrid,
  ActionPlanGrid,
  AddActivityDialog,
  type ActivityResourceOption,
  type ActionPlanActivityView,
} from "@/components/action-plan-grid";
import { Button } from "@/components/ui/button";
import {
  actionPlanActivitySuggestionSchema,
  type ActionPlanActivitySuggestion,
} from "@/lib/action-plan-suggestions";

async function readStreamedActivities(
  response: Response,
  onActivity: (activity: ActionPlanActivitySuggestion) => Promise<void>,
) {
  if (!response.body) {
    throw new Error("Unable to generate activities.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function processLine(line: string) {
    if (!line.trim()) {
      return;
    }

    const parsed = actionPlanActivitySuggestionSchema.safeParse(JSON.parse(line));

    if (!parsed.success) {
      throw new Error("Unable to generate activities.");
    }

    await onActivity(parsed.data);
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      await processLine(line);
    }

    if (done) {
      break;
    }
  }

  await processLine(buffer);
}

export function NoActionPlanState({
  clientId,
  clientName,
  description,
  redirectTo,
  staffOptions = [],
  equipmentOptions = [],
}: {
  clientId: string;
  clientName: string;
  description: string;
  redirectTo: string;
  staffOptions?: ActivityResourceOption[];
  equipmentOptions?: ActivityResourceOption[];
}) {
  const [activities, setActivities] = useState<ActionPlanActivityView[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  async function generate() {
    setIsGenerating(true);
    setActivities([]);

    try {
      const response = await fetch("/api/action-plan/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, description }),
      });

      if (!response.ok) {
        throw new Error("Unable to generate activities.");
      }

      let savedCount = 0;

      await readStreamedActivities(response, async (activity) => {
        const savedActivity = await saveGeneratedActivityAction({ clientId, activity });
        savedCount += 1;
        setActivities((current) => [...current, savedActivity]);
      });

      if (savedCount === 0) {
        throw new Error("No activities were generated.");
      }

      toast.success("Action plan generated.");
    } catch {
      toast.error("Unable to generate activities.");
    } finally {
      setIsGenerating(false);
    }
  }

  if (activities.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex min-h-[28rem] items-center justify-center rounded-md border border-dashed bg-background p-8 text-center">
          <div className="max-w-md">
            <WandSparkles className="mx-auto size-10 text-muted-foreground" />
            <h2 className="mt-4 text-xl font-semibold tracking-tight">No action plan yet</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Add activities for this client&apos;s action plan or generate using AI based on the client&apos;s info
            </p>
            <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
              <AddActivityDialog
                clientId={clientId}
                equipmentOptions={equipmentOptions}
                redirectTo={redirectTo}
                staffOptions={staffOptions}
              />
              <Button loading={isGenerating} onClick={generate} type="button" variant="outline">
                <Sparkles className="size-4" /> Auto generate
              </Button>
            </div>
          </div>
        </div>
        {isGenerating ? <ActionPlanActivityCardSkeletonGrid count={6} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activities.length > 0 ? (
        <ActionPlanGrid
          activities={activities}
          clientId={clientId}
          equipmentOptions={equipmentOptions}
          redirectTo={redirectTo}
          staffOptions={staffOptions}
        />
      ) : null}
      {isGenerating ? <ActionPlanActivityCardSkeletonGrid count={Math.max(1, 6 - activities.length)} /> : null}
    </div>
  );
}
