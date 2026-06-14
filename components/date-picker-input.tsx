"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return undefined;
  }

  return new Date(year, month - 1, day);
}

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string) {
  const date = parseDate(value);

  if (!date) {
    return "Pick a date";
  }

  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function DatePickerInput({
  name,
  defaultValue,
  className,
  minDate,
}: {
  name: string;
  defaultValue: string;
  className?: string;
  minDate?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const min = minDate ? parseDate(minDate) : undefined;

  return (
    <Popover>
      <input name={name} type="hidden" value={value} />
      <PopoverTrigger asChild>
        <Button
          className={cn("w-full justify-start font-normal", className)}
          type="button"
          variant="outline"
        >
          <CalendarIcon className="size-4" />
          {formatDisplayDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={parseDate(value)}
          disabled={min ? (date) => date < min : undefined}
          onSelect={(date) => {
            if (date) {
              setValue(formatInputDate(date));
            }
          }}
          captionLayout="dropdown"
        />
      </PopoverContent>
    </Popover>
  );
}
