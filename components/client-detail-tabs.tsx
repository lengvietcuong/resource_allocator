"use client";

import { CalendarDays, ClipboardList, UserRound } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ClientPanel = "action-plan" | "calendar" | "client-info";

function normalizeClientPanel(value: string | null): ClientPanel {
  return value === "calendar" || value === "client-info" ? value : "action-plan";
}

export function ClientDetailTabs({
  actionPlan,
  calendar,
  clientInfo,
  initialPanel = "action-plan",
}: {
  actionPlan: React.ReactNode;
  calendar: React.ReactNode;
  clientInfo: React.ReactNode;
  initialPanel?: ClientPanel;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [panel, setPanel] = useState<ClientPanel>(initialPanel);

  useEffect(() => {
    setPanel(normalizeClientPanel(searchParams.get("subtab")));
  }, [searchParams]);

  function selectPanel(value: string) {
    const nextPanel = normalizeClientPanel(value);
    const nextParams = new URLSearchParams(searchParams);

    nextParams.set("subtab", nextPanel);
    setPanel(nextPanel);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }

  return (
    <div>
      <div className="sticky top-0 z-20 mb-3 bg-background">
        <Tabs value={panel} onValueChange={selectPanel}>
          <TabsList className="grid h-auto w-full grid-cols-3 p-1">
            <TabsTrigger className="h-9 text-sm" value="action-plan">
              <ClipboardList className="size-4" /> Action plan
            </TabsTrigger>
            <TabsTrigger className="h-9 text-sm" value="calendar">
              <CalendarDays className="size-4" /> Calendar
            </TabsTrigger>
            <TabsTrigger className="h-9 text-sm" value="client-info">
              <UserRound className="size-4" /> Client info
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {panel === "action-plan" ? actionPlan : null}
      {panel === "calendar" ? calendar : null}
      {panel === "client-info" ? clientInfo : null}
    </div>
  );
}
