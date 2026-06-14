"use client";

import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CalendarViewMode } from "@/lib/calendar-url-state";
import { cn } from "@/lib/utils";

const viewOptions: { value: CalendarViewMode; label: string }[] = [
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
  { value: "timeGridDay", label: "Day" },
];

export function CalendarToolbar({
  title,
  view,
  onPrevious,
  onNext,
  onViewChange,
  onExpand,
  actions,
  reserveCloseSpace = false,
}: {
  title: string;
  view: CalendarViewMode;
  onPrevious: () => void;
  onNext: () => void;
  onViewChange: (view: CalendarViewMode) => void;
  onExpand?: () => void;
  actions?: React.ReactNode;
  reserveCloseSpace?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5", reserveCloseSpace && "pr-12")}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <h3 className="max-w-[16rem] truncate text-left text-sm font-semibold tracking-tight text-foreground">
          {title || "Calendar"}
        </h3>
        <div className="flex items-center gap-1">
          <Button aria-label="Previous" onClick={onPrevious} size="icon-sm" type="button" variant="outline">
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button aria-label="Next" onClick={onNext} size="icon-sm" type="button" variant="outline">
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {viewOptions.map((option) => (
            <Button
              className={cn("px-2 text-xs", view === option.value && "bg-primary text-primary-foreground hover:bg-primary/80")}
              key={option.value}
              onClick={() => onViewChange(option.value)}
              size="sm"
              type="button"
              variant={view === option.value ? "default" : "outline"}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {onExpand ? (
          <Button aria-label="Expand calendar" onClick={onExpand} size="icon-sm" type="button" variant="outline">
            <Maximize2 className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1">
        {actions}
      </div>
    </div>
  );
}
