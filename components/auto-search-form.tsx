"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import type { DashboardTab } from "@/lib/data";

export function AutoSearchForm({ tab, query }: { tab: DashboardTab; query: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState(query);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setValue(query);
  }, [query]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-10 pl-9"
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;

          setValue(nextValue);

          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }

          timeoutRef.current = setTimeout(() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("tab", tab);

            const nextQuery = nextValue.trim();

            if (nextQuery) {
              params.set("q", nextQuery);
            } else {
              params.delete("q");
            }

            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }, 250);
        }}
        placeholder={`Search ${tab}`}
      />
    </div>
  );
}
