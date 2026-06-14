import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Atom,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Dumbbell,
  HeartPulse,
  Mail,
  MessageCircle,
  Phone,
  Salad,
  Stethoscope,
  Users,
  Wrench,
} from "lucide-react";

import {
  ActionPlanActivityCard,
  ActionPlanActivityCardSkeletonGrid,
  ActionPlanGrid,
  type ActionPlanActivityView,
  type ActivityResourceOption,
} from "@/components/action-plan-grid";
import { NoActionPlanState } from "@/components/ai-suggestions";
import { AutoSearchForm } from "@/components/auto-search-form";
import { AvailabilityEditorDialog } from "@/components/availability-editor";
import { AvailabilityCalendar, type AvailabilitySlotView, type ResourceCalendarEventView } from "@/components/availability-calendar";
import { ClientDetailTabs } from "@/components/client-detail-tabs";
import { NavigationLoadingProvider, PendingContent } from "@/components/navigation-loading";
import { PendingLink } from "@/components/pending-link";
import { ResourceDetailTabs } from "@/components/resource-detail-tabs";
import { GenerateScheduleDialog, ScheduleCalendar, type CalendarEventView } from "@/components/schedule-calendar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  calendarViewModeFromParam,
  normalizeCalendarDate,
  normalizeCalendarViewParam,
} from "@/lib/calendar-url-state";
import { cn } from "@/lib/utils";
import {
  getDashboardData,
  type DashboardTab,
  type ScheduleProgress,
} from "@/lib/data";
import type { AvailabilitySlot, User } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const tabOptions: { value: DashboardTab; label: string; icon: typeof Users }[] = [
  { value: "clients", label: "Clients", icon: Users },
  { value: "staff", label: "Staff", icon: Stethoscope },
  { value: "equipment", label: "Equipment", icon: Wrench },
];

const dateFormatter = new Intl.DateTimeFormat("en-SG", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Singapore",
});

function param(params: Awaited<SearchParams>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

type DashboardUrlState = {
  tab?: DashboardTab;
  clientId?: string;
  staffId?: string;
  equipmentId?: string;
  subtab?: string;
  q?: string;
  date?: string;
  view?: string;
};

function withQuery(values: DashboardUrlState) {
  const searchParams = new URLSearchParams();
  const scopedValues: DashboardUrlState = { ...values };

  if (scopedValues.tab === "clients") {
    scopedValues.staffId = undefined;
    scopedValues.equipmentId = undefined;
  } else if (scopedValues.tab === "staff") {
    scopedValues.clientId = undefined;
    scopedValues.equipmentId = undefined;
  } else if (scopedValues.tab === "equipment") {
    scopedValues.clientId = undefined;
    scopedValues.staffId = undefined;
  }

  for (const [key, value] of Object.entries(scopedValues)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query ? `/?${query}` : "/";
}

function normalizeTab(value?: string): DashboardTab {
  if (value === "staff" || value === "equipment") {
    return value;
  }

  return "clients";
}

function normalizeClientSubtab(value?: string) {
  return value === "calendar" || value === "client-info" ? value : "action-plan";
}

function normalizeResourceSubtab(value?: string) {
  return value === "relevant" || value === "info" ? value : "calendar";
}

function defaultCalendarDate(
  explicitDate: string | undefined,
  viewParam: string | undefined,
  fallbackDate?: Date | null,
) {
  if (explicitDate) {
    return explicitDate;
  }

  if (!viewParam || viewParam === "week") {
    return new Date().toISOString();
  }

  return (fallbackDate ?? new Date()).toISOString();
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function InitialAvatar({ name }: { name: string }) {
  return (
    <Avatar className="size-9">
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="flex h-72 min-h-0 flex-col gap-3 lg:h-full">
      <Skeleton className="h-10 w-full" />
      <div className="min-h-0 flex-1 rounded-md border p-3">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="flex items-start gap-3 py-2" key={index}>
              <Skeleton className="size-9 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ActionPlanSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-36" />
      </div>
      <ActionPlanActivityCardSkeletonGrid />
    </div>
  );
}

function CalendarPanelSkeleton() {
  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="resource-calendar flex h-[calc(100dvh-18rem)] min-h-[480px] max-h-[680px] flex-col overflow-hidden rounded-md bg-background">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-40" />
            <div className="flex items-center gap-1">
              <Skeleton className="size-8" />
              <Skeleton className="size-8" />
            </div>
            <div className="flex items-center gap-1">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-14" />
              <Skeleton className="h-8 w-12" />
            </div>
            <Skeleton className="size-8" />
          </div>
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="grid flex-1 grid-cols-7 gap-px p-3">
          {Array.from({ length: 35 }).map((_, index) => (
            <Skeleton className="h-full min-h-16 w-full" key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientInfoSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <div className="flex items-start gap-4">
          <Skeleton className="size-9" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-8 w-48" />
          </div>
        </div>
        <Skeleton className="mt-5 h-24 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    </div>
  );
}

function ResourceDetailSkeleton() {
  return <CalendarPanelSkeleton />;
}

function RelevantClientsSkeleton() {
  return (
    <div className="rounded-md border p-4">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="mt-2 h-5 w-72 max-w-full" />
      <Skeleton className="my-3 h-px w-full" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2" key={index}>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <DetailPane>
      <Skeleton className="mb-3 h-9 w-full" />
      <ActionPlanSkeleton />
    </DetailPane>
  );
}

function PageBodySkeleton() {
  return (
    <div className="grid h-full min-h-0 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <SidebarSkeleton />
      <DetailSkeleton />
    </div>
  );
}

function statusBadge(status: User["scheduleStatus"], progress?: ScheduleProgress | null) {
  const progressPercent = progress ? Math.max(0, Math.min(100, Math.floor(progress.percent))) : 0;
  const isPartial = Boolean(progress && progress.missedCount > 0 && progressPercent < 100);
  const label =
    isPartial
      ? `${progressPercent}% scheduled`
      : status === "NO_ACTION_PLAN"
        ? "No action plan"
        : status === "NO_SCHEDULE"
          ? "No schedule"
          : status === "VALID"
            ? "Valid schedule"
            : "Schedule outdated";
  const Icon =
    status === "VALID" && !isPartial
      ? CheckCircle2
      : status === "NO_SCHEDULE" || status === "NO_ACTION_PLAN"
        ? Clock
        : AlertTriangle;
  const className =
    isPartial
      ? "bg-amber-50 text-amber-800"
      : status === "VALID"
        ? "bg-emerald-50 text-emerald-700"
        : status === "INVALID"
          ? "bg-red-50 text-red-700"
          : status === "NO_ACTION_PLAN"
            ? "bg-amber-50 text-amber-700"
            : "bg-slate-100 text-slate-700";

  return (
    <Badge className={className}>
      <Icon className="size-3.5" /> {label}
    </Badge>
  );
}

function roleMeta(role: User["role"]) {
  const roleMap = {
    TRAINER: { label: "Trainer", icon: Dumbbell },
    DOCTOR: { label: "Doctor", icon: Stethoscope },
    PHYSIOTHERAPIST: { label: "Physiotherapist", icon: HeartPulse },
    DIETITIAN: { label: "Dietitian", icon: Salad },
    OCCUPATIONAL_THERAPIST: { label: "Occupational therapist", icon: ClipboardList },
    SPEECH_THERAPIST: { label: "Speech therapist", icon: MessageCircle },
    ADMIN: { label: "Admin", icon: Users },
    CLIENT: { label: "Client", icon: Users },
  } satisfies Record<User["role"], { label: string; icon: typeof Users }>;

  return roleMap[role];
}

function staffCategory(role: User["role"]) {
  return staffCategoryMeta(role).label;
}

function staffCategoryMeta(role: User["role"]) {
  return role === "DOCTOR"
    ? { label: "Specialist", icon: Stethoscope }
    : { label: "Allied health", icon: HeartPulse };
}

function EmptyState() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-16">
      <section className="rounded-md border p-6">
        <h1 className="text-4xl font-semibold tracking-tight">No clients yet</h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">
          Add clients, staff, equipment, and availability to start building action plans and schedules.
        </p>
      </section>
    </main>
  );
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = normalizeTab(param(params, "tab"));
  const subtab = param(params, "subtab");
  const query = (param(params, "q") ?? "").toLowerCase();
  const calendarDate = normalizeCalendarDate(param(params, "date"));
  const calendarView = normalizeCalendarViewParam(param(params, "view"));
  const data = await getDashboardData({
    clientId: param(params, "clientId"),
    staffId: param(params, "staffId"),
    equipmentId: param(params, "equipmentId"),
  });

  if (data.clients.length === 0) {
    return <EmptyState />;
  }

  const urlState: DashboardUrlState = {
    tab,
    clientId: data.selectedClient?.id,
    staffId: data.selectedStaff?.id,
    equipmentId: data.selectedEquipment?.id,
    subtab,
    q: query || undefined,
    date: calendarDate,
    view: calendarView,
  };
  const redirectTo = withQuery(urlState);

  return (
    <main className="h-dvh overflow-hidden bg-background px-4 py-4 text-foreground sm:px-6 lg:px-8">
      <NavigationLoadingProvider>
        <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3">
          <header className="shrink-0 space-y-3">
            <div className="flex items-center gap-3">
              <Atom className="size-7" />
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Resource Allocator</h1>
            </div>
            <Tabs value={tab}>
              <TabsList className="grid h-auto w-full grid-cols-3 p-1">
                {tabOptions.map((option) => {
                  const Icon = option.icon;

                  return (
                    <TabsTrigger asChild className="h-11 text-sm sm:text-base" key={option.value} value={option.value}>
                      <PendingLink href={withQuery({ ...urlState, tab: option.value, subtab: undefined })} scope="content">
                        <Icon className="size-4" /> {option.label}
                      </PendingLink>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </header>

          <div className="min-h-0 flex-1">
            <PendingContent fallback={<PageBodySkeleton />} when="content">
              {tab === "clients" ? (
                <ClientsView
                  calendarDate={calendarDate}
                  calendarView={calendarView}
                  data={data}
                  query={query}
                  redirectTo={redirectTo}
                  subtab={subtab}
                  urlState={urlState}
                />
              ) : tab === "staff" ? (
                <StaffView
                  calendarDate={calendarDate}
                  calendarView={calendarView}
                  data={data}
                  query={query}
                  redirectTo={redirectTo}
                  subtab={subtab}
                  urlState={urlState}
                />
              ) : (
                <EquipmentView
                  calendarDate={calendarDate}
                  calendarView={calendarView}
                  data={data}
                  query={query}
                  redirectTo={redirectTo}
                  subtab={subtab}
                  urlState={urlState}
                />
              )}
            </PendingContent>
          </div>
        </div>
      </NavigationLoadingProvider>
    </main>
  );
}

function EntityPanel({ children, fill = true }: { children: React.ReactNode; fill?: boolean }) {
  return (
    <div className={cn("min-h-0 overflow-hidden rounded-md border p-3", fill && "flex-1")}>
      <div className={cn("flex min-h-0 flex-col", fill && "h-full")}>{children}</div>
    </div>
  );
}

function EntityList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ScrollArea className={cn("min-h-0 overflow-hidden pr-3", className ?? "flex-1")}>
      <div className="divide-y">{children}</div>
    </ScrollArea>
  );
}

function EntityLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-1">
      {sidebar}
      {children}
    </div>
  );
}

function SidebarColumn({
  tab,
  query,
  contentSized = false,
  children,
}: {
  tab: DashboardTab;
  query: string;
  contentSized?: boolean;
  children: React.ReactNode;
}) {
  return (
    <aside
      className={cn(
        "flex min-h-0 max-h-[min(32rem,calc(100dvh-10rem))] flex-col gap-3 overflow-hidden lg:max-h-[calc(100dvh-9rem)]",
        contentSized ? "lg:self-start" : "h-72 lg:h-full",
      )}
    >
      <AutoSearchForm query={query} tab={tab} />
      <EntityPanel fill={!contentSized}>{children}</EntityPanel>
    </aside>
  );
}

function DetailPane({ children }: { children: React.ReactNode }) {
  return <section className="h-full min-h-0 overflow-y-auto pr-2">{children}</section>;
}


function ClientsView({
  calendarDate,
  calendarView,
  data,
  query,
  redirectTo,
  subtab,
  urlState,
}: {
  calendarDate?: string;
  calendarView?: string;
  data: Awaited<ReturnType<typeof getDashboardData>>;
  query: string;
  redirectTo: string;
  subtab?: string;
  urlState: DashboardUrlState;
}) {
  const filteredClients = data.clients
    .filter((client) => `${client.name} ${client.email}`.toLowerCase().includes(query))
    .sort((left, right) => left.id.localeCompare(right.id));
  const client = data.selectedClient;
  const detail = data.clientDetail;

  if (!client || !detail) {
    return null;
  }

  return (
    <EntityLayout
      sidebar={(
        <SidebarColumn query={query} tab="clients">
        <EntityList>
          {filteredClients.map((item) => (
            <PendingLink
              className={cn(
                "block py-3 transition-colors hover:bg-muted/60",
                item.id === client.id && "bg-muted/70",
              )}
              href={withQuery({ ...urlState, tab: "clients", clientId: item.id, subtab, q: query || undefined })}
              key={item.id}
            >
              <div className="px-2">
                <div className="flex min-w-0 items-start gap-3">
                  <InitialAvatar name={item.name} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">{item.name}</p>
                      <span className="shrink-0">{statusBadge(item.scheduleStatus, item.scheduleProgress)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">{item.email}</p>
                  </div>
                </div>
              </div>
            </PendingLink>
          ))}
        </EntityList>
        </SidebarColumn>
      )}
    >

      <DetailPane>
        <ClientDetailTabs
          actionPlan={
            <PendingContent fallback={<ActionPlanSkeleton />} when="detail">
              <ActionPlan
                client={client}
                detail={detail}
                equipment={data.equipment}
                redirectTo={redirectTo}
                staff={data.staff}
              />
            </PendingContent>
          }
          calendar={(
            <PendingContent fallback={<CalendarPanelSkeleton />} when="detail">
              <CalendarSection
                calendarDate={calendarDate}
                calendarView={calendarView}
                detail={detail}
                redirectTo={redirectTo}
                clientId={client.id}
              />
            </PendingContent>
          )}
          clientInfo={(
            <PendingContent fallback={<ClientInfoSkeleton />} when="detail">
              <ClientInfo client={client} />
            </PendingContent>
          )}
          initialPanel={normalizeClientSubtab(subtab)}
        />
      </DetailPane>
    </EntityLayout>
  );
}

function CalendarSection({
  calendarDate,
  calendarView,
  detail,
  clientId,
  redirectTo,
}: {
  calendarDate?: string;
  calendarView?: string;
  detail: NonNullable<Awaited<ReturnType<typeof getDashboardData>>["clientDetail"]>;
  clientId: string;
  redirectTo: string;
}) {
  const calendarEvents: CalendarEventView[] = detail.events.map((event) => ({
    durationMinutes: event.activity?.durationMinutes ?? null,
    equipmentNames: event.equipmentNames,
    frequencyUnit: event.activity?.frequencyUnit ?? null,
    frequencyValue: event.activity?.frequencyValue ?? null,
    id: event.id,
    location: event.activity?.location ?? null,
    metricLabels: event.metricLabels,
    title: event.title,
    start: event.startTime.toISOString(),
    end: event.endTime.toISOString(),
    allDay: event.allDay,
    isManual: event.isManual,
    blocksScheduling: event.blocksScheduling,
    notes: event.notes,
    preparationLabels: event.preparationLabels,
    priority: event.activity?.priority ?? null,
    skippedAdjustment: event.activity?.skippedAdjustment ?? null,
    staffNames: event.staffNames,
    supportsInPerson: event.activity?.supportsInPerson ?? null,
    supportsRemote: event.activity?.supportsRemote ?? null,
    activityType: event.activityType,
  }));
  const calendarSlots: AvailabilitySlotView[] = detail.slots.map((slot) => ({
    id: slot.id,
    start: slot.startsAt.toISOString(),
    end: slot.endsAt.toISOString(),
    availabilityType: slot.availabilityType,
  }));
  const canGenerateSchedule =
    Boolean(detail.currentPlan) && (!detail.currentSchedule || detail.currentSchedule.status === "INVALID");

  return (
    <div>
      <ScheduleCalendar
        availabilitySlots={calendarSlots}
        events={calendarEvents}
        initialDate={defaultCalendarDate(calendarDate, calendarView, detail.currentSchedule?.effectiveFrom)}
        initialView={calendarViewModeFromParam(calendarView)}
        redirectTo={redirectTo}
        toolbarActions={(
          <>
            {canGenerateSchedule ? <GenerateScheduleDialog clientId={clientId} redirectTo={redirectTo} /> : null}
            <AvailabilityEditorDialog
              entityId={clientId}
              entityType="user"
              redirectTo={redirectTo}
              slots={calendarSlots}
            />
          </>
        )}
      />
      <UnscheduledActivitiesList clientId={clientId} items={detail.unscheduledActivities} redirectTo={redirectTo} />
    </div>
  );
}

function UnscheduledActivitiesList({
  clientId,
  items,
  redirectTo,
}: {
  clientId: string;
  items: NonNullable<Awaited<ReturnType<typeof getDashboardData>>["clientDetail"]>["unscheduledActivities"];
  redirectTo: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="mt-4 space-y-3">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <AlertTriangle className="size-5 text-amber-600" /> Unscheduled activities
        </h3>
        <p className="text-sm leading-5 text-muted-foreground">
          These action-plan items couldn&apos;t be scheduled because of timing or resource limits.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => {
          const activity = item.activity;

          if (!activity) {
            return (
              <article className="rounded-md border bg-background p-4" key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-lg font-semibold leading-6">{item.title}</h4>
                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{item.reason}</p>
                  </div>
                  <Badge className="bg-amber-50 text-amber-800">
                    {item.missedCount} missed
                  </Badge>
                </div>
              </article>
            );
          }

          const activityView: ActionPlanActivityView = {
            id: activity.id,
            priority: activity.priority,
            name: activity.name,
            activityType: activity.activityType,
            frequencyValue: activity.frequencyValue,
            frequencyUnit: activity.frequencyUnit,
            durationMinutes: activity.durationMinutes,
            allDay: activity.allDay,
            details: activity.details,
            location: activity.location,
            skippedAdjustment: activity.skippedAdjustment,
            supportsRemote: activity.supportsRemote,
            supportsInPerson: activity.supportsInPerson,
            staffIds: item.staffIds,
            staffNames: item.staffNames,
            equipmentIds: item.equipmentIds,
            equipmentNames: item.equipmentNames,
            metricLabels: item.metricLabels,
            preparationLabels: item.preparationLabels,
            unscheduledMissedCount: item.missedCount,
            unscheduledReason: item.reason,
          };

          return (
            <ActionPlanActivityCard
              activity={activityView}
              clientId={clientId}
              key={item.id}
              readOnly
              redirectTo={redirectTo}
            />
          );
        })}
      </div>
    </section>
  );
}

function ClientInfo({ client }: { client: User }) {
  return (
    <div className="grid gap-6 bg-background lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <div className="flex items-start gap-4">
          <InitialAvatar name={client.name} />
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{client.name}</h2>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">{client.description}</p>
      </div>
      <div className="grid content-start gap-2 text-sm text-muted-foreground lg:pt-1">
          <p className="flex items-center gap-2"><Mail className="size-4" /> {client.email}</p>
          <p className="flex items-center gap-2"><Phone className="size-4" /> {client.phone}</p>
          <p className="flex items-center gap-2"><CalendarDays className="size-4" /> Joined {dateFormatter.format(client.dateJoined)}</p>
      </div>
    </div>
  );
}

function ActionPlan({
  detail,
  client,
  staff,
  equipment,
  redirectTo,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getDashboardData>>["clientDetail"]>;
  client: User;
  staff: Awaited<ReturnType<typeof getDashboardData>>["staff"];
  equipment: Awaited<ReturnType<typeof getDashboardData>>["equipment"];
  redirectTo: string;
}) {
  const staffOptions: ActivityResourceOption[] = staff.map((member) => ({
    id: member.id,
    name: member.name,
    meta: `${roleMeta(member.role).label} · ${staffCategory(member.role)}`,
  }));
  const equipmentOptions: ActivityResourceOption[] = equipment.map((item) => ({
    id: item.id,
    name: item.name,
    meta: `${item.type} · ${item.location}`,
  }));
  const activities: ActionPlanActivityView[] = detail.activities.map((activity) => ({
    id: activity.id,
    priority: activity.priority,
    name: activity.name,
    activityType: activity.activityType,
    frequencyValue: activity.frequencyValue,
    frequencyUnit: activity.frequencyUnit,
    durationMinutes: activity.durationMinutes,
    allDay: activity.allDay,
    details: activity.details,
    location: activity.location,
    skippedAdjustment: activity.skippedAdjustment,
    supportsRemote: activity.supportsRemote,
    supportsInPerson: activity.supportsInPerson,
    staffIds: activity.staffIds,
    staffNames: activity.staffNames,
    equipmentIds: activity.equipmentIds,
    equipmentNames: activity.equipmentNames,
    metricLabels: activity.metricLabels,
    preparationLabels: activity.preparationLabels,
  }));

  if (!detail.currentPlan || activities.length === 0) {
    return (
      <NoActionPlanState
        clientId={client.id}
        clientName={client.name}
        description={client.description}
        equipmentOptions={equipmentOptions}
        redirectTo={redirectTo}
        staffOptions={staffOptions}
      />
    );
  }

  return (
    <ActionPlanGrid
      activities={activities}
      clientId={client.id}
      equipmentOptions={equipmentOptions}
      redirectTo={redirectTo}
      staffOptions={staffOptions}
    />
  );
}

function StaffView({
  calendarDate,
  calendarView,
  data,
  query,
  redirectTo,
  subtab,
  urlState,
}: {
  calendarDate?: string;
  calendarView?: string;
  data: Awaited<ReturnType<typeof getDashboardData>>;
  query: string;
  redirectTo: string;
  subtab?: string;
  urlState: DashboardUrlState;
}) {
  const staff = data.selectedStaff;
  const detail = data.staffDetail;
  const filteredStaff = data.staff.filter((member) =>
    `${member.name} ${member.email} ${member.role}`.toLowerCase().includes(query),
  );

  if (!staff || !detail) {
    return null;
  }

  return (
    <EntityLayout
      sidebar={(
        <SidebarColumn query={query} tab="staff">
        <EntityList>
          {filteredStaff.map((member) => {
            const meta = roleMeta(member.role);
            const RoleIcon = meta.icon;
            const category = staffCategoryMeta(member.role);
            const CategoryIcon = category.icon;

            return (
              <PendingLink
                className={cn("block px-2 py-3 transition-colors hover:bg-muted/60", member.id === staff.id && "bg-muted/70")}
                href={withQuery({ ...urlState, tab: "staff", staffId: member.id, subtab, q: query || undefined })}
                key={member.id}
              >
                <div className="flex items-start gap-3">
                  <InitialAvatar name={member.name} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{member.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      <RoleIcon className="size-3.5 shrink-0" /> {meta.label}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      <CategoryIcon className="size-3.5 shrink-0" /> {category.label}
                    </p>
                  </div>
                </div>
              </PendingLink>
            );
          })}
        </EntityList>
        </SidebarColumn>
      )}
    >
      <DetailPane>
        <ResourceDetailTabs
          calendar={(
            <PendingContent fallback={<ResourceDetailSkeleton />} when="detail">
              <AvailabilitySection
                entityId={staff.id}
                entityType="user"
                events={detail.events}
                initialDate={calendarDate}
                initialView={calendarView}
                redirectTo={redirectTo}
                slots={detail.slots}
              />
            </PendingContent>
          )}
          relevant={(
            <PendingContent fallback={<RelevantClientsSkeleton />} when="detail">
              <RelevantClients clients={detail.affectedClients} urlState={urlState} />
            </PendingContent>
          )}
          info={(
            <PendingContent fallback={<ClientInfoSkeleton />} when="detail">
              <StaffInfo staff={staff} />
            </PendingContent>
          )}
          infoLabel="Staff info"
          initialPanel={normalizeResourceSubtab(subtab)}
        />
      </DetailPane>
    </EntityLayout>
  );
}

function StaffInfo({ staff }: { staff: User }) {
  const meta = roleMeta(staff.role);
  const RoleIcon = meta.icon;
  const category = staffCategoryMeta(staff.role);
  const CategoryIcon = category.icon;

  return (
    <div className="grid gap-6 bg-background lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <div className="flex items-start gap-4">
          <InitialAvatar name={staff.name} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{staff.name}</h2>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge className="justify-start bg-slate-100 text-slate-700"><RoleIcon className="size-3.5" /> {meta.label}</Badge>
                  <Badge className="justify-start bg-purple-50 text-purple-700"><CategoryIcon className="size-3.5" /> {category.label}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className={cn("justify-start", staff.supportsRemote ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500")}>
                    <CheckCircle2 className="size-3.5" /> {staff.supportsRemote ? "Remote" : "No remote"}
                  </Badge>
                  <Badge className={cn("justify-start", staff.supportsInPerson ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                    <CheckCircle2 className="size-3.5" /> {staff.supportsInPerson ? "In person" : "No in-person"}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">{staff.description}</p>
      </div>
      <div className="grid content-start gap-2 text-sm text-muted-foreground lg:pt-1">
        <p className="flex items-center gap-2"><Mail className="size-4" /> {staff.email}</p>
        <p className="flex items-center gap-2"><Phone className="size-4" /> {staff.phone}</p>
        <p className="flex items-center gap-2"><CalendarDays className="size-4" /> Joined {dateFormatter.format(staff.dateJoined)}</p>
      </div>
    </div>
  );
}

function EquipmentView({
  calendarDate,
  calendarView,
  data,
  query,
  redirectTo,
  subtab,
  urlState,
}: {
  calendarDate?: string;
  calendarView?: string;
  data: Awaited<ReturnType<typeof getDashboardData>>;
  query: string;
  redirectTo: string;
  subtab?: string;
  urlState: DashboardUrlState;
}) {
  const selectedEquipment = data.selectedEquipment;
  const detail = data.equipmentDetail;
  const filteredEquipment = data.equipment.filter((item) =>
    `${item.name} ${item.type} ${item.location}`.toLowerCase().includes(query),
  );

  if (!selectedEquipment || !detail) {
    return null;
  }

  return (
    <EntityLayout
      sidebar={(
        <SidebarColumn query={query} tab="equipment">
        <EntityList>
          {filteredEquipment.map((item) => (
            <PendingLink
              className={cn("block px-2 py-3 transition-colors hover:bg-muted/60", item.id === selectedEquipment.id && "bg-muted/70")}
              href={withQuery({ ...urlState, tab: "equipment", equipmentId: item.id, subtab, q: query || undefined })}
              key={item.id}
            >
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.type}</p>
              </div>
            </PendingLink>
          ))}
        </EntityList>
        </SidebarColumn>
      )}
    >
      <DetailPane>
        <ResourceDetailTabs
          calendar={(
            <PendingContent fallback={<ResourceDetailSkeleton />} when="detail">
              <AvailabilitySection
                entityId={selectedEquipment.id}
                entityType="equipment"
                events={detail.events}
                initialDate={calendarDate}
                initialView={calendarView}
                redirectTo={redirectTo}
                slots={detail.slots}
              />
            </PendingContent>
          )}
          relevant={(
            <PendingContent fallback={<RelevantClientsSkeleton />} when="detail">
              <RelevantClients clients={detail.affectedClients} urlState={urlState} />
            </PendingContent>
          )}
          info={(
            <PendingContent fallback={<ClientInfoSkeleton />} when="detail">
              <EquipmentInfo equipment={selectedEquipment} />
            </PendingContent>
          )}
          infoLabel="Equipment info"
          initialPanel={normalizeResourceSubtab(subtab)}
        />
      </DetailPane>
    </EntityLayout>
  );
}

function EquipmentInfo({
  equipment,
}: {
  equipment: NonNullable<Awaited<ReturnType<typeof getDashboardData>>["selectedEquipment"]>;
}) {
  return (
    <div className="grid gap-6 bg-background lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{equipment.name}</h2>
        </div>
        <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">{equipment.description}</p>
      </div>
      <div className="grid content-start gap-2 text-sm text-muted-foreground lg:pt-1">
        <p className="flex items-center gap-2"><Wrench className="size-4" /> {equipment.type}</p>
        <p className="flex items-center gap-2"><CalendarDays className="size-4" /> {equipment.location}</p>
      </div>
    </div>
  );
}

function AvailabilitySection({
  initialDate,
  initialView,
  slots,
  events = [],
  entityId,
  entityType,
  redirectTo,
}: {
  initialDate?: string;
  initialView?: string;
  slots: AvailabilitySlot[];
  events?: {
    id: string;
    activityId: string;
    title: string;
    startTime: Date;
    endTime: Date;
    allDay: boolean;
    isManual: boolean;
    blocksScheduling: boolean;
    notes: string;
    activityType: ResourceCalendarEventView["activityType"];
    frequencyValue: number;
    frequencyUnit: ResourceCalendarEventView["frequencyUnit"];
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
  }[];
  entityId: string;
  entityType: "user" | "equipment";
  redirectTo: string;
}) {
  const calendarSlots: AvailabilitySlotView[] = slots.map((slot) => ({
    id: slot.id,
    start: slot.startsAt.toISOString(),
    end: slot.endsAt.toISOString(),
    availabilityType: slot.availabilityType,
  }));
  const calendarEvents: ResourceCalendarEventView[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.startTime.toISOString(),
    end: event.endTime.toISOString(),
    allDay: event.allDay,
    isManual: event.isManual,
    blocksScheduling: event.blocksScheduling,
    activityType: event.activityType,
    frequencyValue: event.frequencyValue,
    frequencyUnit: event.frequencyUnit,
    durationMinutes: event.durationMinutes,
    location: event.location,
    skippedAdjustment: event.skippedAdjustment,
    supportsRemote: event.supportsRemote,
    supportsInPerson: event.supportsInPerson,
    details: event.details,
    clientName: event.clientName,
    staffNames: event.staffNames,
    equipmentNames: event.equipmentNames,
    metricLabels: event.metricLabels,
    preparationLabels: event.preparationLabels,
    notes: event.notes,
  }));

  return (
    <div>
      <AvailabilityCalendar
        events={calendarEvents}
        initialDate={defaultCalendarDate(initialDate, initialView, slots[0]?.startsAt ?? events[0]?.startTime)}
        initialView={calendarViewModeFromParam(initialView)}
        redirectTo={redirectTo}
        slots={calendarSlots}
        toolbarActions={(
          <AvailabilityEditorDialog
            entityId={entityId}
            entityType={entityType}
            redirectTo={redirectTo}
            slots={calendarSlots}
          />
        )}
      />
    </div>
  );
}

function RelevantClients({
  clients,
  urlState,
}: {
  clients: {
    scheduleId: string;
    clientId: string;
    clientName: string;
    description: string;
    email: string;
    phone: string;
    dateJoined: Date;
    status: User["scheduleStatus"];
    scheduleProgress: ScheduleProgress | null;
  }[];
  urlState: DashboardUrlState;
}) {
  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold"><Activity className="size-5" /> Relevant clients</h3>
      {clients.length === 0 ? <p className="text-sm text-muted-foreground">No current schedules depend on this resource yet.</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((client) => (
          <Link
            className="block rounded-md border bg-background p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={withQuery({ ...urlState, tab: "clients", clientId: client.clientId, subtab: undefined })}
            key={`${client.scheduleId}-${client.clientId}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <InitialAvatar name={client.clientName} />
                <div className="min-w-0">
                  <h4 className="text-lg font-semibold leading-6">{client.clientName}</h4>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{client.description}</p>
                </div>
              </div>
              <div className="shrink-0">{statusBadge(client.status, client.scheduleProgress)}</div>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2"><Mail className="size-4" /> {client.email}</p>
              <p className="flex items-center gap-2"><Phone className="size-4" /> {client.phone}</p>
              <p className="flex items-center gap-2"><CalendarDays className="size-4" /> Joined {dateFormatter.format(client.dateJoined)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
