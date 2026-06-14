export function parseLocalTime(time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

  if (!match) {
    throw new Error("Time is invalid.");
  }

  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

export function parseLocalDateTime(date: string, time: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!dateMatch) {
    throw new Error("Date or time is invalid.");
  }

  const [, yearValue, monthValue, dayValue] = dateMatch;
  const { hours, minutes } = parseLocalTime(time);
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const parsed = new Date(year, month - 1, day, hours, minutes);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error("Date or time is invalid.");
  }

  return parsed;
}

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

export function addLocalDays(date: Date, days: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function dateWithLocalTime(date: Date, time: string) {
  const { hours, minutes } = parseLocalTime(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
}

export function localTimeRangeOnOrAfterDate(date: Date, startTime: string, endTime: string) {
  const startsAt = dateWithLocalTime(date, startTime);
  let endsAt = dateWithLocalTime(date, endTime);

  if (endsAt.getTime() === startsAt.getTime()) {
    throw new Error("End time must be after start time.");
  }

  if (endsAt < startsAt) {
    endsAt = addLocalDays(endsAt, 1);
  }

  return { startsAt, endsAt };
}
