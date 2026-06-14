export type CalendarViewMode = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
export type CalendarViewParam = "month" | "week" | "day";

const paramToViewMode: Record<CalendarViewParam, CalendarViewMode> = {
  month: "dayGridMonth",
  week: "timeGridWeek",
  day: "timeGridDay",
};

const viewModeToParam: Record<CalendarViewMode, CalendarViewParam> = {
  dayGridMonth: "month",
  timeGridWeek: "week",
  timeGridDay: "day",
};

export function normalizeCalendarDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime()) ? undefined : value;
}

export function normalizeCalendarViewParam(value?: string) {
  return value === "month" || value === "day" || value === "week" ? value : undefined;
}

export function calendarViewModeFromParam(value?: string): CalendarViewMode {
  return paramToViewMode[normalizeCalendarViewParam(value) ?? "week"];
}

export function calendarViewParamFromMode(value: CalendarViewMode): CalendarViewParam {
  return viewModeToParam[value];
}

export function dateParamFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
