"use client";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { CalendarApi, EventInput } from "@fullcalendar/core";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarClock,
  CalendarSync,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  HeartPulse,
  ListChecks,
  MapPin,
  Info,
  Save,
  Tag,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  deleteEventAction,
  editEventAction,
  generateScheduleAction,
} from "@/app/actions/resource-allocator";
import { CalendarToolbar } from "@/components/calendar-toolbar";
import { DatePickerInput } from "@/components/date-picker-input";
import { TimeInput } from "@/components/time-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  availabilityBackgroundEvents,
  type AvailabilitySlotView,
} from "@/components/availability-overlays";
import {
  calendarViewParamFromMode,
  dateParamFromDate,
  type CalendarViewMode,
} from "@/lib/calendar-url-state";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CalendarEventView = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  isManual: boolean;
  blocksScheduling: boolean;
  activityType: "FITNESS" | "FOOD" | "MEDICATION" | "THERAPY" | "CONSULTATION" | null;
  notes: string;
  priority?: number | null;
  frequencyValue?: number | null;
  frequencyUnit?: "DAY" | "WEEK" | "MONTH" | "YEAR" | null;
  durationMinutes?: number | null;
  location?: string | null;
  supportsRemote?: boolean | null;
  supportsInPerson?: boolean | null;
  skippedAdjustment?: string | null;
  staffNames?: string[];
  equipmentNames?: string[];
  metricLabels?: string[];
  preparationLabels?: string[];
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

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventTypeLabel(event: CalendarEventView) {
  return event.activityType ? titleCase(event.activityType) : event.isManual ? "Custom event" : "Schedule event";
}

function eventSourceLabel(event: CalendarEventView) {
  return event.isManual ? "Scheduled manually" : "Scheduled automatically";
}

function frequencyLabel(event: CalendarEventView) {
  if (!event.frequencyValue || !event.frequencyUnit) {
    return "Not specified";
  }

  return `${event.frequencyValue} per ${event.frequencyUnit.toLowerCase()}`;
}

function supportLabel(event: CalendarEventView) {
  const values = [
    event.supportsRemote ? "Remote" : null,
    event.supportsInPerson ? "In person" : null,
  ].filter(Boolean);

  return values.length > 0 ? values.join(", ") : "Not specified";
}

function formatEventRange(event: CalendarEventView) {
  const start = new Date(event.start);
  const end = new Date(event.end);

  if (event.allDay) {
    return `${eventDateFormatter.format(start)} - ${eventDateFormatter.format(end)}`;
  }

  return `${eventDateTimeFormatter.format(start)} - ${eventDateTimeFormatter.format(end)}`;
}

function inputDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function inputTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

function EventDateTimeFields({
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultAllDay = false,
}: {
  defaultDate: string;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultAllDay?: boolean;
}) {
  const [allDay, setAllDay] = useState(defaultAllDay);

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Label className="grid gap-1 text-sm font-medium">
        Date
        <DatePickerInput defaultValue={defaultDate} name="startDate" />
      </Label>
      <Label className="grid gap-1 text-sm font-medium">
        Start
        <TimeInput disabled={allDay} defaultValue={defaultStartTime} name="startTime" placeholder="09:00" required={!allDay} />
      </Label>
      <Label className="grid gap-1 text-sm font-medium">
        End
        <TimeInput disabled={allDay} defaultValue={defaultEndTime} name="endTime" placeholder="10:00" required={!allDay} />
      </Label>
      <Label className="grid gap-1 text-sm font-medium">
        All day
        <span className="flex h-8 items-center gap-2 rounded-lg border px-2.5 font-normal">
          <Checkbox
            checked={allDay}
            name="allDay"
            onCheckedChange={(checked) => setAllDay(checked === true)}
          />
          Enabled
        </span>
      </Label>
    </div>
  );
}

function SubmitButton({
  children,
  form,
  variant,
}: {
  children: React.ReactNode;
  form?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const { pending } = useFormStatus();

  return (
    <Button form={form} loading={pending} type="submit" variant={variant}>
      {children}
    </Button>
  );
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

export function GenerateScheduleDialog({
  clientId,
  redirectTo,
}: {
  clientId: string;
  redirectTo: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button">
          <CalendarSync className="size-4" /> Generate schedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate schedule</DialogTitle>
          <DialogDescription>Choose the date the generated schedule should start from.</DialogDescription>
        </DialogHeader>
        <form action={generateScheduleAction} className="grid gap-4">
          <input name="clientId" type="hidden" value={clientId} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <Label className="grid gap-1 text-sm font-medium">
            From date
            <DatePickerInput defaultValue={inputDate()} minDate={inputDate()} name="effectiveDate" />
          </Label>
          <Label className="grid gap-1 text-sm font-medium">
            Planning span
            <Select defaultValue="90" name="horizonDays">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Next 30 days</SelectItem>
                <SelectItem value="60">Next 60 days</SelectItem>
                <SelectItem value="90">Next 90 days</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <SubmitButton><Save className="size-4" /> Save</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleCalendarFrame({
  calendarEvents,
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
  calendarEvents: EventInput[];
  eventById: Map<string, CalendarEventView>;
  initialDate: string;
  initialView: CalendarViewMode;
  isExpanded?: boolean;
  onExpand?: () => void;
  onHoverEvent: (event: CalendarEventView | null, x?: number, y?: number) => void;
  onHoverUnavailable: (position: { x: number; y: number } | null) => void;
  onSelectEvent: (event: CalendarEventView | null) => void;
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
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          firstDay={1}
          initialView={initialView}
          initialDate={initialDate}
          height="100%"
          nowIndicator
          selectable={false}
          eventDisplay="block"
          eventMinHeight={22}
          slotEventOverlap={false}
          expandRows
          headerToolbar={false}
          events={calendarEvents}
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

export function ScheduleCalendar({
  events,
  availabilitySlots = [],
  initialDate,
  initialView,
  redirectTo,
  toolbarActions,
}: {
  events: CalendarEventView[];
  availabilitySlots?: AvailabilitySlotView[];
  initialDate: string;
  initialView: CalendarViewMode;
  redirectTo: string;
  toolbarActions?: React.ReactNode;
}) {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [currentRedirectTo, setCurrentRedirectTo] = useState(redirectTo);
  const [hoveredEvent, setHoveredEvent] = useState<{
    event: CalendarEventView;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredUnavailable, setHoveredUnavailable] = useState<{ x: number; y: number } | null>(null);
  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const calendarEvents = useMemo<EventInput[]>(
    () =>
      [
        ...availabilityBackgroundEvents(availabilitySlots),
        ...events.map((event) => ({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          classNames: [
            event.isManual ? "event-source-manual" : "event-source-generated",
            `event-type-${(event.activityType ?? (event.isManual ? "manual" : "schedule")).toLowerCase()}`,
          ],
        })),
      ],
    [availabilitySlots, events],
  );

  return (
    <>
      <div className="resource-calendar flex h-[calc(100dvh-18rem)] min-h-[480px] max-h-[680px] flex-col overflow-hidden rounded-md bg-background">
        <ScheduleCalendarFrame
          calendarEvents={calendarEvents}
          eventById={eventById}
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
          <DialogTitle className="sr-only">Expanded calendar</DialogTitle>
          <div className="resource-calendar flex h-full flex-col overflow-hidden bg-background">
            <ScheduleCalendarFrame
              calendarEvents={calendarEvents}
              eventById={eventById}
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
      {hoveredEvent ? <CalendarEventTooltip event={hoveredEvent.event} x={hoveredEvent.x} y={hoveredEvent.y} /> : null}
      {hoveredUnavailable ? <UnavailableSlotTooltip x={hoveredUnavailable.x} y={hoveredUnavailable.y} /> : null}
      <EventDetailsDialog
        event={selectedEvent}
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

function CalendarEventTooltip({ event, x, y }: { event: CalendarEventView; x: number; y: number }) {
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-sm rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
      style={{ left: x, top: y }}
    >
      <p className="font-medium leading-5">{event.title}</p>
      <div className="mt-2 grid gap-1.5">
        <TooltipRow icon={Clock}>{formatEventRange(event)}</TooltipRow>
        <TooltipRow icon={Activity}>{eventTypeLabel(event)}</TooltipRow>
        <TooltipRow icon={CalendarClock}>{eventSourceLabel(event)}</TooltipRow>
        <TooltipRow icon={CalendarClock}>Frequency: {frequencyLabel(event)}</TooltipRow>
        <TooltipRow icon={Clock}>Duration: {event.allDay ? "All day" : `${event.durationMinutes ?? "?"} min`}</TooltipRow>
        <TooltipRow icon={Users}>Staff: {event.staffNames?.join(", ") || "Self-guided"}</TooltipRow>
        <TooltipRow icon={Wrench}>Equipment: {event.equipmentNames?.join(", ") || "No equipment"}</TooltipRow>
        <TooltipRow icon={MapPin}>Location: {event.location || "Flexible"}</TooltipRow>
        <TooltipRow icon={CheckCircle2}>Supported mode: {supportLabel(event)}</TooltipRow>
        <TooltipRow icon={HeartPulse}>Metrics: {event.metricLabels?.join(", ") || "None"}</TooltipRow>
        <TooltipRow icon={ListChecks}>Preparation: {event.preparationLabels?.join(", ") || "None"}</TooltipRow>
        {event.skippedAdjustment ? <TooltipRow icon={Flame}>If skipped: {event.skippedAdjustment}</TooltipRow> : null}
        {event.notes ? <TooltipRow icon={FileText}><span className="line-clamp-3">{event.notes}</span></TooltipRow> : null}
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

export function EventDetailsDialog({
  event,
  onOpenChange,
  redirectTo,
}: {
  event: CalendarEventView | null;
  onOpenChange: (open: boolean) => void;
  redirectTo: string;
}) {
  const start = event ? new Date(event.start) : new Date();
  const end = event ? new Date(event.end) : new Date();

  return (
    <Dialog open={Boolean(event)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Event details</DialogTitle>
        </DialogHeader>
        {event ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-slate-100 text-slate-700">
                <Info className="size-3.5" /> {eventSourceLabel(event)}
              </Badge>
              <Badge className="bg-blue-50 text-blue-700">
                <Tag className="size-3.5" /> {eventTypeLabel(event)}
              </Badge>
            </div>
            <form action={editEventAction} className="grid gap-4" key={event.id}>
              <input name="eventId" type="hidden" value={event.id} />
              <input name="redirectTo" type="hidden" value={redirectTo} />
              <Label className="grid gap-1 text-sm font-medium">
                Event title
                <Input defaultValue={event.title} name="title" placeholder="Enter a concise event title" required />
              </Label>
              <EventDateTimeFields
                defaultAllDay={event.allDay}
                defaultDate={inputDate(start)}
                defaultEndTime={inputTime(end)}
                defaultStartTime={inputTime(start)}
              />
              <Label className="grid gap-1 text-sm font-medium">
                Notes
                <Textarea defaultValue={event.notes} name="notes" placeholder="Add notes or scheduling context" />
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button type="button" variant="destructive">
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete event</DialogTitle>
                      <DialogDescription>Choose how much of this event series should be removed.</DialogDescription>
                    </DialogHeader>
                    <form action={deleteEventAction} className="grid gap-3">
                      <input name="eventId" type="hidden" value={event.id} />
                      <input name="redirectTo" type="hidden" value={redirectTo} />
                      <Label className="flex items-start gap-3 rounded-md border p-3 text-sm font-normal">
                        <input className="mt-1" defaultChecked name="deleteScope" type="radio" value="single" />
                        <span>
                          <span className="block font-medium">Delete just this event.</span>
                          <span className="mt-1 block text-muted-foreground">Keep other scheduled instances unchanged.</span>
                        </span>
                      </Label>
                      <Label className="flex items-start gap-3 rounded-md border p-3 text-sm font-normal">
                        <input className="mt-1" name="deleteScope" type="radio" value="future" />
                        <span>
                          <span className="block font-medium">Delete all similar events in the future.</span>
                          <span className="mt-1 block text-muted-foreground">Remove this event and matching future occurrences.</span>
                        </span>
                      </Label>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button type="button" variant="outline">Cancel</Button>
                        </DialogClose>
                        <SubmitButton variant="destructive">
                          <Trash2 className="size-4" /> Delete
                        </SubmitButton>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <DialogClose asChild>
                    <Button type="button" variant="outline">Cancel</Button>
                  </DialogClose>
                  <SubmitButton><Save className="size-4" /> Save</SubmitButton>
                </div>
              </div>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
