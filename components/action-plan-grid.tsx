"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Dumbbell,
  Flame,
  HeartPulse,
  ListChecks,
  ListFilter,
  MapPin,
  Pencil,
  Pill,
  Plus,
  Save,
  Salad,
  Stethoscope,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { addActivityAction, deleteActivityAction, editActivityAction } from "@/app/actions/resource-allocator";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export type ActionPlanActivityView = {
  id: string;
  priority: number;
  name: string;
  activityType: "FITNESS" | "FOOD" | "MEDICATION" | "THERAPY" | "CONSULTATION";
  frequencyValue: number;
  frequencyUnit: "DAY" | "WEEK" | "MONTH" | "YEAR";
  durationMinutes: number;
  allDay: boolean;
  details: string;
  location: string | null;
  skippedAdjustment: string | null;
  supportsRemote: boolean | null;
  supportsInPerson: boolean | null;
  staffIds: string[];
  staffNames: string[];
  equipmentIds: string[];
  equipmentNames: string[];
  metricLabels: string[];
  preparationLabels: string[];
  unscheduledMissedCount?: number;
  unscheduledReason?: string;
};

export type ActivityResourceOption = {
  id: string;
  name: string;
  meta?: string;
};

type SortMode =
  | "priority-high"
  | "priority-low"
  | "name-az"
  | "name-za";

const activityTypeMeta = {
  FITNESS: { label: "Fitness", icon: Dumbbell, className: "bg-blue-50 text-blue-900" },
  FOOD: { label: "Nutrition", icon: Salad, className: "bg-emerald-50 text-emerald-900" },
  MEDICATION: { label: "Medication", icon: Pill, className: "bg-violet-50 text-violet-900" },
  THERAPY: { label: "Therapy", icon: Flame, className: "bg-orange-50 text-orange-900" },
  CONSULTATION: { label: "Consultation", icon: Stethoscope, className: "bg-zinc-100 text-zinc-900" },
} satisfies Record<ActionPlanActivityView["activityType"], { label: string; icon: typeof Dumbbell; className: string }>;

function frequencyLabel(activity: ActionPlanActivityView) {
  const unit = activity.frequencyUnit.toLowerCase();
  return `${activity.frequencyValue} per ${unit}`;
}

function priorityMeta(priority: number) {
  if (priority === 1) {
    return {
      label: "Critical",
      className: "bg-red-50 text-red-900",
    };
  }

  if (priority === 2) {
    return {
      label: "High",
      className: "bg-amber-50 text-amber-900",
    };
  }

  if (priority === 3) {
    return {
      label: "Medium",
      className: "bg-blue-50 text-blue-900",
    };
  }

  return {
    label: "Low",
    className: "bg-slate-100 text-slate-700",
  };
}

const priorityOptions = [
  { value: "1", label: "Critical" },
  { value: "2", label: "High" },
  { value: "3", label: "Medium" },
  { value: "4", label: "Low" },
];

const frequencyValueOptions = Array.from({ length: 12 }, (_, index) => String(index + 1));
const durationOptions = ["5", "10", "12", "15", "20", "25", "30", "40", "45", "50", "60", "75", "90", "120", "180", "240"];

function prioritySelectValue(priority: number) {
  if (priority <= 1) {
    return "1";
  }

  if (priority === 2) {
    return "2";
  }

  if (priority === 3) {
    return "3";
  }

  return "4";
}

function durationSelectOptions(current?: number) {
  const values = new Set(durationOptions);

  if (current) {
    values.add(String(current));
  }

  return Array.from(values).sort((left, right) => Number(left) - Number(right));
}

function supportLabel(activity: ActionPlanActivityView) {
  const values = [
    activity.supportsRemote ? "Remote" : null,
    activity.supportsInPerson ? "In person" : null,
  ].filter(Boolean);

  return values.length > 0 ? values.join(", ") : "Not specified";
}

function ActivityField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 text-sm leading-6">
      <span className="flex h-6 w-3.5 shrink-0 items-center justify-center">
        <Icon className="size-3.5 text-muted-foreground" />
      </span>
      <p className="min-w-0">
        <span className="font-medium text-foreground">{label}:</span>{" "}
        <span className="text-muted-foreground">{value}</span>
      </p>
    </div>
  );
}

export function ActionPlanActivityCardSkeleton() {
  return (
    <article className="rounded-md border bg-background p-4">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Skeleton className="size-7" />
            <Skeleton className="size-7" />
          </div>
        </div>
        <Skeleton className="h-6 w-3/4" />
      </header>
      <div className="mt-3 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
      </div>
      <div className="mt-4 grid gap-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="flex items-center gap-2" key={index}>
            <Skeleton className="size-3.5 shrink-0" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </article>
  );
}

export function ActionPlanActivityCardSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: count }).map((_, index) => (
        <ActionPlanActivityCardSkeleton key={index} />
      ))}
    </div>
  );
}

function SubmitButton({
  children,
  variant,
  className,
  form,
}: {
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
  form?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button className={className} form={form} loading={pending} type="submit" variant={variant}>
      {children}
    </Button>
  );
}

function ResourcePicker({
  title,
  name,
  options,
  defaultIds = [],
}: {
  title: string;
  name: string;
  options: ActivityResourceOption[];
  defaultIds?: string[];
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{title}</p>
      <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
        {options.map((option) => (
          <Label className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted/60" key={option.id}>
            <Checkbox defaultChecked={defaultIds.includes(option.id)} name={name} value={option.id} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{option.name}</span>
              {option.meta ? <span className="block truncate text-xs text-muted-foreground">{option.meta}</span> : null}
            </span>
          </Label>
        ))}
      </div>
    </div>
  );
}

function DeleteActivityDialog({
  activity,
  clientId,
  redirectTo,
  trigger,
}: {
  activity: Pick<ActionPlanActivityView, "id" | "name">;
  clientId: string;
  redirectTo: string;
  trigger: React.ReactNode;
}) {
  const deleteFormId = `delete-activity-${activity.id}`;

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete activity</DialogTitle>
          <DialogDescription>
            Delete {activity.name}? This removes it from the client&apos;s action plan.
          </DialogDescription>
        </DialogHeader>
        <form action={deleteActivityAction} className="contents" id={deleteFormId}>
          <input name="activityId" type="hidden" value={activity.id} />
          <input name="clientId" type="hidden" value={clientId} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
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
  );
}

export function AddActivityDialog({
  clientId,
  redirectTo,
  staffOptions = [],
  equipmentOptions = [],
}: {
  clientId: string;
  redirectTo: string;
  staffOptions?: ActivityResourceOption[];
  equipmentOptions?: ActivityResourceOption[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button">
          <Plus className="size-4" /> Add activity
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl overflow-visible pb-4">
        <DialogHeader>
          <DialogTitle>Add activity</DialogTitle>
          <DialogDescription>Add a new activity to the current action plan.</DialogDescription>
        </DialogHeader>
        <form action={addActivityAction} className="contents">
          <input name="clientId" type="hidden" value={clientId} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <div className="grid max-h-[calc(100dvh-14rem)] gap-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <Label className="grid gap-1 text-sm font-medium">
                Activity name
                <Input name="name" placeholder="e.g. Zone 2 aerobic conditioning" required />
              </Label>
              <Label className="grid gap-1 text-sm font-medium">
                Priority
                <Select defaultValue="3" name="priority">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Label className="grid gap-1 text-sm font-medium sm:col-span-2">
                Type
                <Select defaultValue="FITNESS" name="activityType">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FITNESS">Fitness</SelectItem>
                    <SelectItem value="FOOD">Food</SelectItem>
                    <SelectItem value="MEDICATION">Medication</SelectItem>
                    <SelectItem value="THERAPY">Therapy</SelectItem>
                    <SelectItem value="CONSULTATION">Consultation</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-sm font-medium">
                Frequency
                <Select defaultValue="3" name="frequencyValue">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {frequencyValueOptions.map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-sm font-medium">
                Unit
                <Select defaultValue="WEEK" name="frequencyUnit">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">Day</SelectItem>
                    <SelectItem value="WEEK">Week</SelectItem>
                    <SelectItem value="MONTH">Month</SelectItem>
                    <SelectItem value="YEAR">Year</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <Label className="grid gap-1 text-sm font-medium">
                Minutes
                <Select defaultValue="45" name="durationMinutes">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {durationSelectOptions().map((value) => (
                      <SelectItem key={value} value={value}>{value} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-sm font-medium">
                Location
                <Input name="location" placeholder="Performance suite or remote" />
              </Label>
            </div>
            <Label className="grid gap-1 text-sm font-medium">
              Details
              <Textarea name="details" placeholder="Describe the protocol instructions and scheduling constraints." required />
            </Label>
            <Label className="grid gap-1 text-sm font-medium">
              Adjustment if skipped
              <Input name="skippedAdjustment" placeholder="e.g. Add a shorter backup session within 48 hours" />
            </Label>
            <div className="grid gap-2 sm:grid-cols-3">
              <Label className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                <input name="supportsRemote" type="hidden" value="off" />
                <Checkbox name="supportsRemote" /> Remote
              </Label>
              <Label className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                <input name="supportsInPerson" type="hidden" value="off" />
                <Checkbox name="supportsInPerson" /> In person
              </Label>
              <Label className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                <Checkbox name="allDay" /> All day
              </Label>
            </div>
            <ResourcePicker name="staffIds" options={staffOptions} title="Staff" />
            <ResourcePicker name="equipmentIds" options={equipmentOptions} title="Equipment" />
          </div>
          <DialogFooter className="pt-1">
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

export function ActivityEditDialog({
  activity,
  clientId,
  redirectTo,
  staffOptions = [],
  equipmentOptions = [],
}: {
  activity: ActionPlanActivityView;
  clientId: string;
  redirectTo: string;
  staffOptions?: ActivityResourceOption[];
  equipmentOptions?: ActivityResourceOption[];
}) {
  const editFormId = `edit-activity-${activity.id}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          aria-label={`Edit ${activity.name}`}
          className="text-muted-foreground hover:text-foreground"
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl overflow-visible pb-4">
        <DialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
          <DialogDescription>Update the activity details used to build the client&apos;s schedule.</DialogDescription>
        </DialogHeader>
        <form action={editActivityAction} className="contents" id={editFormId}>
          <input name="activityId" type="hidden" value={activity.id} />
          <input name="clientId" type="hidden" value={clientId} />
          <input name="redirectTo" type="hidden" value={redirectTo} />
          <div className="grid max-h-[calc(100dvh-16rem)] gap-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <Label className="grid gap-1 text-sm font-medium">
                Activity name
                <Input defaultValue={activity.name} name="name" placeholder="e.g. Zone 2 aerobic conditioning" required />
              </Label>
              <Label className="grid gap-1 text-sm font-medium">
                Priority
                <Select defaultValue={prioritySelectValue(activity.priority)} name="priority">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Label className="grid gap-1 text-sm font-medium sm:col-span-2">
                Type
                <Select defaultValue={activity.activityType} name="activityType">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FITNESS">Fitness</SelectItem>
                    <SelectItem value="FOOD">Food</SelectItem>
                    <SelectItem value="MEDICATION">Medication</SelectItem>
                    <SelectItem value="THERAPY">Therapy</SelectItem>
                    <SelectItem value="CONSULTATION">Consultation</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-sm font-medium">
                Frequency
                <Select defaultValue={String(activity.frequencyValue)} name="frequencyValue">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {frequencyValueOptions.map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-sm font-medium">
                Unit
                <Select defaultValue={activity.frequencyUnit} name="frequencyUnit">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">Day</SelectItem>
                    <SelectItem value="WEEK">Week</SelectItem>
                    <SelectItem value="MONTH">Month</SelectItem>
                    <SelectItem value="YEAR">Year</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <Label className="grid gap-1 text-sm font-medium">
                Minutes
                <Select defaultValue={String(activity.durationMinutes)} name="durationMinutes">
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {durationSelectOptions(activity.durationMinutes).map((value) => (
                      <SelectItem key={value} value={value}>{value} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-sm font-medium">
                Location
                <Input defaultValue={activity.location ?? ""} name="location" placeholder="Performance suite or remote" />
              </Label>
            </div>
            <Label className="grid gap-1 text-sm font-medium">
              Details
              <Textarea defaultValue={activity.details} name="details" placeholder="Describe the protocol instructions and scheduling constraints." required />
            </Label>
            <Label className="grid gap-1 text-sm font-medium">
              Adjustment if skipped
              <Input defaultValue={activity.skippedAdjustment ?? ""} name="skippedAdjustment" placeholder="e.g. Add a shorter backup session within 48 hours" />
            </Label>
            <div className="grid gap-2 sm:grid-cols-3">
              <Label className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                <input name="supportsRemote" type="hidden" value="off" />
                <Checkbox defaultChecked={Boolean(activity.supportsRemote)} name="supportsRemote" /> Remote
              </Label>
              <Label className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                <input name="supportsInPerson" type="hidden" value="off" />
                <Checkbox defaultChecked={Boolean(activity.supportsInPerson)} name="supportsInPerson" /> In person
              </Label>
              <Label className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                <Checkbox defaultChecked={activity.allDay} name="allDay" /> All day
              </Label>
            </div>
            <ResourcePicker defaultIds={activity.staffIds} name="staffIds" options={staffOptions} title="Staff" />
            <ResourcePicker defaultIds={activity.equipmentIds} name="equipmentIds" options={equipmentOptions} title="Equipment" />
          </div>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <DeleteActivityDialog
              activity={activity}
              clientId={clientId}
              redirectTo={redirectTo}
              trigger={<Button type="button" variant="destructive"><Trash2 className="size-4" /> Delete</Button>}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <SubmitButton>
                <Save className="size-4" /> Save
              </SubmitButton>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ActionPlanGrid({
  activities,
  clientId,
  redirectTo,
  showToolbar = true,
  readOnly = false,
  staffOptions = [],
  equipmentOptions = [],
}: {
  activities: ActionPlanActivityView[];
  clientId: string;
  redirectTo: string;
  showToolbar?: boolean;
  readOnly?: boolean;
  staffOptions?: ActivityResourceOption[];
  equipmentOptions?: ActivityResourceOption[];
}) {
  const [sort, setSort] = useState<SortMode>("priority-high");
  const sortedActivities = useMemo(() => {
    return [...activities].sort((left, right) => {
      if (sort === "priority-low") {
        return right.priority - left.priority || left.name.localeCompare(right.name);
      }

      if (sort === "name-az") {
        return left.name.localeCompare(right.name);
      }

      if (sort === "name-za") {
        return right.name.localeCompare(left.name);
      }

      return left.priority - right.priority || left.name.localeCompare(right.name);
    });
  }, [activities, sort]);

  return (
    <div className="space-y-4">
      {showToolbar ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
          <SelectTrigger className="w-56 justify-start gap-1 [&>svg:last-child]:ml-auto">
            <span className="flex min-w-0 items-center gap-1 text-left">
              <ListFilter className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority-high">Priority (highest first)</SelectItem>
            <SelectItem value="priority-low">Priority (lowest first)</SelectItem>
            <SelectItem value="name-az">Name A-Z</SelectItem>
            <SelectItem value="name-za">Name Z-A</SelectItem>
          </SelectContent>
        </Select>
        <AddActivityDialog
          clientId={clientId}
          equipmentOptions={equipmentOptions}
          redirectTo={redirectTo}
          staffOptions={staffOptions}
        />
      </div> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {sortedActivities.map((activity) => (
          <ActionPlanActivityCard
            activity={activity}
            clientId={clientId}
            equipmentOptions={equipmentOptions}
            key={activity.id}
            readOnly={readOnly}
            redirectTo={redirectTo}
            staffOptions={staffOptions}
          />
        ))}
      </div>
    </div>
  );
}

export function ActionPlanActivityCard({
  activity,
  clientId,
  redirectTo,
  staffOptions = [],
  equipmentOptions = [],
  readOnly = false,
}: {
  activity: ActionPlanActivityView;
  clientId: string;
  redirectTo: string;
  staffOptions?: ActivityResourceOption[];
  equipmentOptions?: ActivityResourceOption[];
  readOnly?: boolean;
}) {
  const meta = activityTypeMeta[activity.activityType];
  const priority = priorityMeta(activity.priority);
  const Icon = meta.icon;
  const showUnscheduledInline = readOnly && activity.unscheduledReason;

  return (
    <article className="rounded-md border bg-background p-4">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={meta.className}>
              <Icon className="size-3.5" /> {meta.label}
            </Badge>
            <Badge className={priority.className}>{priority.label}</Badge>
          </div>
          {readOnly ? (
            activity.unscheduledMissedCount ? (
              <Badge className="ml-auto shrink-0 bg-amber-50 text-amber-900">
                {activity.unscheduledMissedCount} missed
              </Badge>
            ) : null
          ) : <div className="flex shrink-0 items-center gap-1">
            <ActivityEditDialog
              activity={activity}
              clientId={clientId}
              equipmentOptions={equipmentOptions}
              redirectTo={redirectTo}
              staffOptions={staffOptions}
            />
            <DeleteActivityDialog
              activity={activity}
              clientId={clientId}
              redirectTo={redirectTo}
              trigger={(
                <Button
                  aria-label={`Delete ${activity.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            />
          </div>}
        </div>
        <h3 className="text-lg font-semibold leading-6">{activity.name}</h3>
      </header>
      {showUnscheduledInline ? (
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">{activity.unscheduledReason}</p>
      ) : null}
      {activity.unscheduledReason && !readOnly ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" /> Couldn&apos;t schedule
            </span>
            {activity.unscheduledMissedCount ? (
              <Badge className="bg-amber-100 text-amber-950">
                {activity.unscheduledMissedCount} missed
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-line text-amber-900">{activity.unscheduledReason}</p>
        </div>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{activity.details}</p>
      <div className="mt-4 grid gap-2">
        <ActivityField icon={CalendarDays} label="Frequency" value={frequencyLabel(activity)} />
        <ActivityField icon={Clock} label="Duration" value={activity.allDay ? "All day" : `${activity.durationMinutes} min`} />
        <ActivityField icon={Users} label="Staff" value={activity.staffNames.join(", ") || "Self-guided"} />
        <ActivityField icon={Wrench} label="Equipment" value={activity.equipmentNames.join(", ") || "No equipment"} />
        <ActivityField icon={MapPin} label="Location" value={activity.location || "Flexible"} />
        <ActivityField icon={CheckCircle2} label="Supported mode" value={supportLabel(activity)} />
        <ActivityField icon={HeartPulse} label="Metrics" value={activity.metricLabels.join(", ") || "None"} />
        <ActivityField icon={ListChecks} label="Preparation" value={activity.preparationLabels.join(", ") || "None"} />
        {activity.skippedAdjustment ? <ActivityField icon={Flame} label="If skipped" value={activity.skippedAdjustment} /> : null}
      </div>
    </article>
  );
}
