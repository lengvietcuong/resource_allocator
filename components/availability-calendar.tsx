"use client";

import dayGridPlugin from "@fullcalendar/daygrid";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { CalendarApi, EventInput } from "@fullcalendar/core";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  HeartPulse,
  ListChecks,
  MapPin,
  Users,
  Wrench,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { CalendarToolbar } from "@/components/calendar-toolbar";
import { EventDetailsDialog, type CalendarEventView } from "@/components/schedule-calendar";
import {
  availabilityBackgroundEvents,
  type AvailabilitySlotView,
} from "@/components/availability-overlays";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  calendarViewParamFromMode,
  dateParamFromDate,
  type CalendarViewMode,
} from "@/lib/calendar-url-state";

export type { AvailabilitySlotView } from "@/components/availability-overlays";

export type ResourceCalendarEventView = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  isManual: boolean;
  blocksScheduling: boolean;
  activityType: "FITNESS" | "FOOD" | "MEDICATION" | "THERAPY" | "CONSULTATION";
  frequencyValue: number;
  frequencyUnit: "DAY" | "WEEK" | "MONTH" | "YEAR";
  durationMinutes: number;
  location: string | null;
  skippedAdjustment: string | null;
  supportsRemote: boolean | null;
  supportsInPerson: boolean | null;
  details: string;
  clientName: string;
  staffNames: string[];
  equipmentNames: string[];
  metricLabels: string[];
  preparationLabels: string[];
  notes: string;
};

const eventDateTimeFormatter = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const eventDateFormatter = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  day: "2-digit",
  month: "short",
});

function formatEventRange(event: ResourceCalendarEventView) {
  const start = new Date(event.start);
  const end = new Date(event.end);

  if (event.allDay) {
    return `${eventDateFormatter.format(start)} - ${eventDateFormatter.format(end)}`;
  }

  return `${eventDateTimeFormatter.format(start)} - ${eventDateTimeFormatter.format(end)}`;
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function frequencyLabel(event: ResourceCalendarEventView) {
  return `${event.frequencyValue} per ${event.frequencyUnit.toLowerCase()}`;
}

function supportLabel(event: ResourceCalendarEventView) {
  const values = [
    event.supportsRemote ? "Remote" : null,
    event.supportsInPerson ? "In person" : null,
  ].filter(Boolean);

  return values.length > 0 ? values.join(", ") : "Not specified";
}

function TooltipRow({
  icon: Icon,
  children,
}: {
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2 leading-5 text-muted-foreground">
      <Icon className="size-3.5 shrink-0 text-foreground" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function AvailabilityCalendarFrame({
  events,
  eventById,
  initialDate,
  initialView,
  isExpanded = false,
  onExpand,
  onHoverEvent,
  onHoverUnavailable,
  onSelectEvent,
  onRedirectToChange,
  toolbarActions,
}: {
  events: EventInput[];
  eventById: Map<string, ResourceCalendarEventView>;
  initialDate: string;
  initialView: CalendarViewMode;
  isExpanded?: boolean;
  onExpand?: () => void;
  onHoverEvent: (event: ResourceCalendarEventView | null, x?: number, y?: number) => void;
  onHoverUnavailable: (position: { x: number; y: number } | null) => void;
  onSelectEvent: (event: ResourceCalendarEventView | null) => void;
  onRedirectToChange: (redirectTo: string) => void;
  toolbarActions?: React.ReactNode;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const pathname = usePathname();
  const [title, setTitle] = useState("");
  const [view, setView] = useState<CalendarViewMode>(initialView);
  const updateCalendarUrl = useCallback(
    (date: Date, nextView: CalendarViewMode) => {
      const params = new URLSearchParams(window.location.search);

      params.set("subtab", "calendar");
      params.set("date", dateParamFromDate(date));
      params.set("view", calendarViewParamFromMode(nextView));

      const query = params.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;

      window.history.replaceState(null, "", nextUrl);
      onRedirectToChange(nextUrl);
    },
    [onRedirectToChange, pathname],
  );

  function withApi(callback: (api: CalendarApi) => void) {
    const api = calendarRef.current?.getApi();

    if (api) {
      callback(api);
    }
  }

  function changeView(api: CalendarApi, nextView: CalendarViewMode) {
    api.changeView(nextView);
  }

  return (
    <>
      <CalendarToolbar
        actions={toolbarActions}
        onExpand={isExpanded ? undefined : onExpand}
        onNext={() => withApi((api) => api.next())}
        onPrevious={() => withApi((api) => api.prev())}
        onViewChange={(nextView) => withApi((api) => changeView(api, nextView))}
        reserveCloseSpace={isExpanded}
        title={title}
        view={view}
      />
      <div className="min-h-0 flex-1">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin]}
          firstDay={1}
          initialView={initialView}
          initialDate={initialDate}
          height="100%"
          nowIndicator
          eventDisplay="block"
          eventMinHeight={22}
          expandRows
          headerToolbar={false}
          events={events}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", meridiem: false }}
          datesSet={(info) => {
            setTitle(info.view.title);
            setView(info.view.type as CalendarViewMode);
            updateCalendarUrl(info.view.currentStart, info.view.type as CalendarViewMode);
          }}
          eventContent={(info) => (
            <div className="min-w-0 leading-tight">
              <div className="line-clamp-2 text-[0.7rem] font-medium">{info.event.title}</div>
              {info.timeText ? <div className="truncate text-[0.64rem] opacity-80">{info.timeText}</div> : null}
            </div>
          )}
          eventMouseEnter={(info) => {
            if (info.event.extendedProps.unavailableSlot) {
              onHoverUnavailable({ x: info.jsEvent.clientX + 12, y: info.jsEvent.clientY + 12 });
              return;
            }

            const event = eventById.get(info.event.id);

            if (event) {
              onHoverEvent(event, info.jsEvent.clientX + 12, info.jsEvent.clientY + 12);
            }
          }}
          eventMouseLeave={() => {
            onHoverEvent(null);
            onHoverUnavailable(null);
          }}
          eventClick={(info) => onSelectEvent(info.event.extendedProps.unavailableSlot ? null : eventById.get(info.event.id) ?? null)}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
        />
      </div>
    </>
  );
}

export function AvailabilityCalendar({
  slots,
  events = [],
  initialDate,
  initialView,
  redirectTo,
  toolbarActions,
}: {
  slots: AvailabilitySlotView[];
  events?: ResourceCalendarEventView[];
  initialDate: string;
  initialView: CalendarViewMode;
  redirectTo: string;
  toolbarActions?: React.ReactNode;
}) {
  const [selectedEvent, setSelectedEvent] = useState<ResourceCalendarEventView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [currentRedirectTo, setCurrentRedirectTo] = useState(redirectTo);
  const [hoveredEvent, setHoveredEvent] = useState<{
    event: ResourceCalendarEventView;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredUnavailable, setHoveredUnavailable] = useState<{ x: number; y: number } | null>(null);
  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const calendarEvents = useMemo<EventInput[]>(
    () => [
      ...availabilityBackgroundEvents(slots),
      ...events.map((event) => ({
        id: event.id,
        title: `${event.clientName}: ${event.title}`,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        classNames: ["resource-booking", `event-type-${event.activityType.toLowerCase()}`],
      })),
    ],
    [events, slots],
  );

  return (
    <>
      <div className="resource-calendar flex h-[calc(100dvh-18rem)] min-h-[28rem] flex-col overflow-hidden rounded-md bg-background">
        <AvailabilityCalendarFrame
          eventById={eventById}
          events={calendarEvents}
          initialDate={initialDate}
          initialView={initialView}
          onExpand={() => setExpanded(true)}
          onHoverEvent={(event, x = 0, y = 0) => setHoveredEvent(event ? { event, x, y } : null)}
          onHoverUnavailable={setHoveredUnavailable}
          onRedirectToChange={setCurrentRedirectTo}
          onSelectEvent={setSelectedEvent}
          toolbarActions={toolbarActions}
        />
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="h-[96dvh] max-h-[96dvh] w-[98vw] max-w-[98vw] border-0 bg-background p-0 shadow-none">
          <DialogTitle className="sr-only">Expanded resource calendar</DialogTitle>
          <div className="resource-calendar flex h-full flex-col overflow-hidden bg-background">
            <AvailabilityCalendarFrame
              eventById={eventById}
              events={calendarEvents}
              initialDate={initialDate}
              initialView={initialView}
              isExpanded
              onHoverEvent={(event, x = 0, y = 0) => setHoveredEvent(event ? { event, x, y } : null)}
              onHoverUnavailable={setHoveredUnavailable}
              onRedirectToChange={setCurrentRedirectTo}
              onSelectEvent={setSelectedEvent}
              toolbarActions={toolbarActions}
            />
          </div>
        </DialogContent>
      </Dialog>
      {hoveredEvent ? <ResourceEventTooltip event={hoveredEvent.event} x={hoveredEvent.x} y={hoveredEvent.y} /> : null}
      {hoveredUnavailable ? <UnavailableSlotTooltip x={hoveredUnavailable.x} y={hoveredUnavailable.y} /> : null}
      <EventDetailsDialog
        event={selectedEvent ? resourceEventToCalendarEvent(selectedEvent) : null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEvent(null);
          }
        }}
        redirectTo={currentRedirectTo}
      />
    </>
  );
}

function resourceEventToCalendarEvent(event: ResourceCalendarEventView): CalendarEventView {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    isManual: event.isManual,
    blocksScheduling: event.blocksScheduling,
    activityType: event.activityType,
    notes: event.notes,
    frequencyValue: event.frequencyValue,
    frequencyUnit: event.frequencyUnit,
    durationMinutes: event.durationMinutes,
    location: event.location,
    supportsRemote: event.supportsRemote,
    supportsInPerson: event.supportsInPerson,
    skippedAdjustment: event.skippedAdjustment,
    staffNames: event.staffNames,
    equipmentNames: event.equipmentNames,
    metricLabels: event.metricLabels,
    preparationLabels: event.preparationLabels,
  };
}

function ResourceEventTooltip({ event, x, y }: { event: ResourceCalendarEventView; x: number; y: number }) {
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-sm rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
      style={{ left: x, top: y }}
    >
      <p className="font-medium leading-5">{event.title}</p>
      <div className="mt-2 grid gap-1.5">
        <TooltipRow icon={Users}>Client: {event.clientName}</TooltipRow>
        <TooltipRow icon={Clock}>{formatEventRange(event)}</TooltipRow>
        <TooltipRow icon={Activity}>{titleCase(event.activityType)}</TooltipRow>
        <TooltipRow icon={CalendarClock}>Frequency: {frequencyLabel(event)}</TooltipRow>
        <TooltipRow icon={Clock}>Duration: {event.allDay ? "All day" : `${event.durationMinutes} min`}</TooltipRow>
        <TooltipRow icon={Users}>Staff: {event.staffNames.join(", ") || "Self-guided"}</TooltipRow>
        <TooltipRow icon={Wrench}>Equipment: {event.equipmentNames.join(", ") || "No equipment"}</TooltipRow>
        <TooltipRow icon={MapPin}>Location: {event.location || "Flexible"}</TooltipRow>
        <TooltipRow icon={CheckCircle2}>Supported mode: {supportLabel(event)}</TooltipRow>
        <TooltipRow icon={HeartPulse}>Metrics: {event.metricLabels.join(", ") || "None"}</TooltipRow>
        <TooltipRow icon={ListChecks}>Preparation: {event.preparationLabels.join(", ") || "None"}</TooltipRow>
        {event.skippedAdjustment ? <TooltipRow icon={Flame}>If skipped: {event.skippedAdjustment}</TooltipRow> : null}
        {event.details ? <TooltipRow icon={FileText}><span className="line-clamp-3">{event.details}</span></TooltipRow> : null}
      </div>
    </div>
  );
}

function UnavailableSlotTooltip({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-xs rounded-md border bg-popover px-3 py-2 text-xs font-medium text-popover-foreground shadow-lg"
      style={{ left: x, top: y }}
    >
      This time slot is unavailable.
    </div>
  );
}
