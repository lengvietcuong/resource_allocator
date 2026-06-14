"use client";

import { CalendarDays, Info, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ResourcePanel = "calendar" | "relevant" | "info";

function normalizeResourcePanel(value: string | null): ResourcePanel {
  return value === "relevant" || value === "info" ? value : "calendar";
}

export function ResourceDetailTabs({
  calendar,
  relevant,
  info,
  infoLabel,
  initialPanel = "calendar",
}: {
  calendar: React.ReactNode;
  relevant: React.ReactNode;
  info: React.ReactNode;
  infoLabel: string;
  initialPanel?: ResourcePanel;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [panel, setPanel] = useState<ResourcePanel>(initialPanel);

  useEffect(() => {
    setPanel(normalizeResourcePanel(searchParams.get("subtab")));
  }, [searchParams]);

  function selectPanel(value: string) {
    const nextPanel = normalizeResourcePanel(value);
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
            <TabsTrigger className="h-9 text-sm" value="calendar">
              <CalendarDays className="size-4" /> Availability
            </TabsTrigger>
            <TabsTrigger className="h-9 text-sm" value="relevant">
              <Users className="size-4" /> Relevant clients
            </TabsTrigger>
            <TabsTrigger className="h-9 text-sm" value="info">
              <Info className="size-4" /> {infoLabel}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {panel === "calendar" ? calendar : null}
      {panel === "relevant" ? relevant : null}
      {panel === "info" ? info : null}
    </div>
  );
}
