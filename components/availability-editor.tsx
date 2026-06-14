"use client";

import { Ban, CalendarDays, Clock, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  deleteAvailabilityPeriodAction,
  saveAvailabilityPeriodAction,
  saveUnavailableExceptionAction,
} from "@/app/actions/resource-allocator";
import type { AvailabilitySlotView } from "@/components/availability-overlays";
import { DatePickerInput } from "@/components/date-picker-input";
import { TimeInput } from "@/components/time-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type AvailabilityEntityType = "user" | "equipment";
type AdjustMode = "available" | "unavailable";

type AvailabilityGroup = {
  key: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  weekdays: number[];
  slotIds: string[];
};

const weekdayOptions = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function dateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function timeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isMidnight(date: Date) {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
}

function isSameLocalDate(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function isAllDaySlot(slot: AvailabilitySlotView) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);

  return isMidnight(start) && isMidnight(end) && end > start;
}

function exceptionEndDateValue(slot: AvailabilitySlotView) {
  const end = new Date(slot.end);
  return dateValue(isAllDaySlot(slot) ? addDays(end, -1) : end);
}

function groupAvailableSlots(slots: AvailabilitySlotView[]) {
  const groups = new Map<string, AvailabilityGroup>();

  for (const slot of slots.filter((item) => item.availabilityType === "AVAILABLE")) {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const startTime = timeValue(start);
    const endTime = timeValue(end);
    const endsNextDay = !isSameLocalDate(start, end);
    const key = `${startTime}-${endTime}-${endsNextDay ? "next" : "same"}`;
    const group = groups.get(key) ?? {
      key,
      startTime,
      endTime,
      endsNextDay,
      weekdays: [],
      slotIds: [],
    };

    group.slotIds.push(slot.id);

    if (!group.weekdays.includes(start.getDay())) {
      group.weekdays.push(start.getDay());
    }

    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    weekdays: group.weekdays.sort((left, right) => {
      const leftIndex = weekdayOptions.findIndex((day) => day.value === left);
      const rightIndex = weekdayOptions.findIndex((day) => day.value === right);
      return leftIndex - rightIndex;
    }),
  })).sort((left, right) => left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime));
}

function unavailableTimeOff(slots: AvailabilitySlotView[]) {
  return slots
    .filter((slot) => slot.availabilityType === "UNAVAILABLE")
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
}

function dayLabels(weekdays: number[]) {
  return weekdays
    .map((weekday) => weekdayOptions.find((option) => option.value === weekday)?.label)
    .filter(Boolean)
    .join(", ");
}

function timeRangeLabel(startTime: string, endTime: string, endsNextDay: boolean) {
  return `${startTime} - ${endTime}${endsNextDay ? " next day" : ""}`;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <Button loading={pending} type="submit">
      {children}
    </Button>
  );
}

function AvailabilityActionForm({
  action,
  className,
  children,
  confirmationDescription = "This availability change may affect existing schedules. Automatically regenerate relevant schedules now?",
}: {
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  children: React.ReactNode;
  confirmationDescription?: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const updateChoiceRef = useRef<HTMLInputElement | null>(null);
  const confirmedRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function submitWithChoice(updateRelevantSchedules: boolean) {
    confirmedRef.current = true;

    if (updateChoiceRef.current) {
      updateChoiceRef.current.value = updateRelevantSchedules ? "yes" : "no";
    }

    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form
        action={action}
        className={className}
        onSubmit={(event) => {
          if (confirmedRef.current) {
            return;
          }

          event.preventDefault();
          setConfirmOpen(true);
        }}
        ref={formRef}
      >
        <input name="updateRelevantSchedules" ref={updateChoiceRef} type="hidden" value="yes" />
        {children}
      </form>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update relevant schedules?</DialogTitle>
            <DialogDescription>{confirmationDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button onClick={() => submitWithChoice(false)} type="button" variant="outline">No</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button onClick={() => submitWithChoice(true)} type="button">Yes</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeleteButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button loading={pending} size="icon-sm" type="submit" variant="destructive">
      <Trash2 className="size-4" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

function WeekdayPicker({ defaultWeekdays }: { defaultWeekdays?: number[] }) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      {weekdayOptions.map((day) => (
        <Label
          className="flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-normal"
          key={day.value}
        >
          <Checkbox
            defaultChecked={defaultWeekdays?.includes(day.value)}
            name="weekdays"
            value={String(day.value)}
          />
          {day.label}
        </Label>
      ))}
    </div>
  );
}

function WeeklyHoursForm({
  entityType,
  entityId,
  redirectTo,
  group,
}: {
  entityType: AvailabilityEntityType;
  entityId: string;
  redirectTo: string;
  group?: AvailabilityGroup;
}) {
  return (
    <AvailabilityActionForm action={saveAvailabilityPeriodAction} className="contents">
      <input name="entityType" type="hidden" value={entityType} />
      <input name="entityId" type="hidden" value={entityId} />
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <input name="slotIds" type="hidden" value={group?.slotIds.join(",") ?? ""} />
      <input name="availabilityType" type="hidden" value="AVAILABLE" />
      <div className="grid max-h-[calc(100dvh-12rem)] gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Label className="grid gap-1 text-sm font-medium">
            Start
            <TimeInput defaultValue={group?.startTime ?? "09:00"} name="startTime" placeholder="09:00" required />
          </Label>
          <Label className="grid gap-1 text-sm font-medium">
            End
            <TimeInput defaultValue={group?.endTime ?? "17:00"} name="endTime" placeholder="17:00" required />
          </Label>
        </div>
        <div className="grid gap-1 text-sm font-medium">
          <span>Days</span>
          <WeekdayPicker defaultWeekdays={group?.weekdays ?? [1, 2, 3, 4, 5]} />
        </div>
      </div>
      <div className="flex justify-end pt-1">
        <SubmitButton><Save className="size-4" /> Save</SubmitButton>
      </div>
    </AvailabilityActionForm>
  );
}

function TimeOffFields({
  defaultStartDate,
  defaultEndDate,
  defaultStartTime,
  defaultEndTime,
  defaultAllDay = false,
}: {
  defaultStartDate: string;
  defaultEndDate: string;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultAllDay?: boolean;
}) {
  const [allDay, setAllDay] = useState(defaultAllDay);

  return (
    <div className="grid gap-3 sm:grid-cols-5">
      <Label className="grid gap-1 text-sm font-medium">
        Start date
        <DatePickerInput defaultValue={defaultStartDate} name="startDate" />
      </Label>
      <Label className="grid gap-1 text-sm font-medium">
        End date
        <DatePickerInput defaultValue={defaultEndDate} name="endDate" />
      </Label>
      <Label className="grid gap-1 text-sm font-medium">
        Start time
        <TimeInput disabled={allDay} defaultValue={defaultStartTime} name="startTime" placeholder="09:00" required={!allDay} />
      </Label>
      <Label className="grid gap-1 text-sm font-medium">
        End time
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

function TimeOffForm({
  entityType,
  entityId,
  redirectTo,
  slot,
}: {
  entityType: AvailabilityEntityType;
  entityId: string;
  redirectTo: string;
  slot?: AvailabilitySlotView;
}) {
  const start = slot ? new Date(slot.start) : new Date();
  const end = slot ? new Date(slot.end) : new Date();
  const allDay = slot ? isAllDaySlot(slot) : false;

  return (
    <AvailabilityActionForm
      action={saveUnavailableExceptionAction}
      className="contents"
      confirmationDescription="This time off may affect existing schedules. Automatically regenerate relevant schedules now?"
    >
      <input name="entityType" type="hidden" value={entityType} />
      <input name="entityId" type="hidden" value={entityId} />
      <input name="redirectTo" type="hidden" value={redirectTo} />
      <input name="slotIds" type="hidden" value={slot?.id ?? ""} />
      <div className="grid max-h-[calc(100dvh-12rem)] gap-4 overflow-y-auto pr-1">
        <TimeOffFields
          defaultAllDay={allDay}
          defaultEndDate={slot ? exceptionEndDateValue(slot) : dateValue(end)}
          defaultEndTime={slot && !allDay ? timeValue(end) : "10:00"}
          defaultStartDate={dateValue(start)}
          defaultStartTime={slot && !allDay ? timeValue(start) : "09:00"}
        />
      </div>
      <div className="flex justify-end pt-1">
        <SubmitButton><Save className="size-4" /> Save</SubmitButton>
      </div>
    </AvailabilityActionForm>
  );
}

function WeeklyHoursRow({
  entityType,
  entityId,
  redirectTo,
  group,
  onEdit,
}: {
  entityType: AvailabilityEntityType;
  entityId: string;
  redirectTo: string;
  group: AvailabilityGroup;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4 text-muted-foreground" /> {timeRangeLabel(group.startTime, group.endTime, group.endsNextDay)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{dayLabels(group.weekdays)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button aria-label="Edit weekly hours" onClick={onEdit} size="icon-sm" type="button" variant="ghost">
          <Pencil className="size-3.5" />
        </Button>
        <AvailabilityActionForm action={deleteAvailabilityPeriodAction}>
          <input name="entityType" type="hidden" value={entityType} />
          <input name="entityId" type="hidden" value={entityId} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <input name="slotIds" type="hidden" value={group.slotIds.join(",")} />
          <DeleteButton label="Delete weekly hours" />
        </AvailabilityActionForm>
      </div>
    </div>
  );
}

function TimeOffRow({
  entityType,
  entityId,
  redirectTo,
  slot,
  onEdit,
}: {
  entityType: AvailabilityEntityType;
  entityId: string;
  redirectTo: string;
  slot: AvailabilitySlotView;
  onEdit: () => void;
}) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const allDay = isAllDaySlot(slot);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Ban className="size-4 text-muted-foreground" /> {dateValue(start)} - {exceptionEndDateValue(slot)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {allDay ? "All day" : `${timeValue(start)} - ${timeValue(end)}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button aria-label="Edit time off" onClick={onEdit} size="icon-sm" type="button" variant="ghost">
          <Pencil className="size-3.5" />
        </Button>
        <AvailabilityActionForm
          action={deleteAvailabilityPeriodAction}
          confirmationDescription="Deleting this time off may affect existing schedules. Automatically regenerate relevant schedules now?"
        >
          <input name="entityType" type="hidden" value={entityType} />
          <input name="entityId" type="hidden" value={entityId} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <input name="slotIds" type="hidden" value={slot.id} />
          <DeleteButton label="Delete time off" />
        </AvailabilityActionForm>
      </div>
    </div>
  );
}

function WeeklyHoursCard({
  groups,
  entityType,
  entityId,
  redirectTo,
  onAdd,
  onEdit,
}: {
  groups: AvailabilityGroup[];
  entityType: AvailabilityEntityType;
  entityId: string;
  redirectTo: string;
  onAdd: () => void;
  onEdit: (group: AvailabilityGroup) => void;
}) {
  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4" /> Weekly hours</h3>
        <Button onClick={onAdd} size="sm" type="button" variant="outline">
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
      <div className="mt-2">
        {groups.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No weekly hours yet.</p> : null}
        {groups.map((group, index) => (
          <div key={group.key}>
            {index > 0 ? <Separator /> : null}
            <WeeklyHoursRow
              entityId={entityId}
              entityType={entityType}
              group={group}
              onEdit={() => onEdit(group)}
              redirectTo={redirectTo}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function TimeOffCard({
  slots,
  entityType,
  entityId,
  redirectTo,
  onAdd,
  onEdit,
}: {
  slots: AvailabilitySlotView[];
  entityType: AvailabilityEntityType;
  entityId: string;
  redirectTo: string;
  onAdd: () => void;
  onEdit: (slot: AvailabilitySlotView) => void;
}) {
  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Ban className="size-4" /> Time off</h3>
        <Button onClick={onAdd} size="sm" type="button" variant="outline">
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
      <div className="mt-2">
        {slots.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No time off yet.</p> : null}
        {slots.map((slot, index) => (
          <div key={slot.id}>
            {index > 0 ? <Separator /> : null}
            <TimeOffRow
              entityId={entityId}
              entityType={entityType}
              onEdit={() => onEdit(slot)}
              redirectTo={redirectTo}
              slot={slot}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function AdjustAvailabilityDialog({
  entityType,
  entityId,
  redirectTo,
  mode,
  group,
  slot,
  open,
  onOpenChange,
}: {
  entityType: AvailabilityEntityType;
  entityId: string;
  redirectTo: string;
  mode: AdjustMode;
  group?: AvailabilityGroup;
  slot?: AvailabilitySlotView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isWeeklyHours = mode === "available";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl grid-rows-[auto_minmax(0,auto)_auto] overflow-visible pb-4">
        <DialogHeader>
          <DialogTitle>{isWeeklyHours ? "Adjust weekly hours" : "Adjust time off"}</DialogTitle>
          <DialogDescription>
            {isWeeklyHours
              ? "Set recurring availability by weekday."
              : "Block a one-off date range without changing weekly hours."}
          </DialogDescription>
        </DialogHeader>
        {isWeeklyHours ? (
          <WeeklyHoursForm
            entityId={entityId}
            entityType={entityType}
            group={group}
            key={`weekly-hours-${group?.key ?? "new"}`}
            redirectTo={redirectTo}
          />
        ) : (
          <TimeOffForm
            entityId={entityId}
            entityType={entityType}
            key={`time-off-${slot?.id ?? "new"}`}
            redirectTo={redirectTo}
            slot={slot}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AvailabilityEditorDialog({
  entityType,
  entityId,
  slots,
  redirectTo,
}: {
  entityType: AvailabilityEntityType;
  entityId: string;
  slots: AvailabilitySlotView[];
  redirectTo: string;
}) {
  const weeklyHours = useMemo(() => groupAvailableSlots(slots), [slots]);
  const timeOff = useMemo(() => unavailableTimeOff(slots), [slots]);
  const [listOpen, setListOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustMode, setAdjustMode] = useState<AdjustMode>("available");
  const [editingWeeklyHoursKey, setEditingWeeklyHoursKey] = useState<string | null>(null);
  const [editingTimeOffId, setEditingTimeOffId] = useState<string | null>(null);
  const editingWeeklyHours = weeklyHours.find((group) => group.key === editingWeeklyHoursKey);
  const editingTimeOff = timeOff.find((slot) => slot.id === editingTimeOffId);

  function openAdjust(mode: AdjustMode, editId: string | null = null) {
    setAdjustMode(mode);
    setEditingWeeklyHoursKey(mode === "available" ? editId : null);
    setEditingTimeOffId(mode === "unavailable" ? editId : null);
    setAdjustOpen(true);
  }

  return (
    <>
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline">
            <Pencil className="size-4" /> Edit availability
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl gap-3">
          <DialogHeader>
            <DialogTitle>Edit availability</DialogTitle>
            <DialogDescription>
              Manage weekly hours and time off. Client bookings appear on the calendar separately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[min(70dvh,42rem)] gap-4 overflow-y-auto pr-2 pb-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <WeeklyHoursCard
              entityId={entityId}
              entityType={entityType}
              groups={weeklyHours}
              onAdd={() => openAdjust("available")}
              onEdit={(group) => openAdjust("available", group.key)}
              redirectTo={redirectTo}
            />
            <div className="h-px bg-border lg:h-full lg:w-px" />
            <TimeOffCard
              entityId={entityId}
              entityType={entityType}
              onAdd={() => openAdjust("unavailable")}
              onEdit={(slot) => openAdjust("unavailable", slot.id)}
              redirectTo={redirectTo}
              slots={timeOff}
            />
          </div>
        </DialogContent>
      </Dialog>
      <AdjustAvailabilityDialog
        entityId={entityId}
        entityType={entityType}
        group={editingWeeklyHours}
        mode={adjustMode}
        onOpenChange={setAdjustOpen}
        open={adjustOpen}
        redirectTo={redirectTo}
        slot={editingTimeOff}
      />
    </>
  );
}
