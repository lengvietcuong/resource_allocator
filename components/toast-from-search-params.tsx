"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function ToastFromSearchParams() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lastToast = useRef<string | null>(null);
  const message = searchParams.get("toast");
  const type = searchParams.get("toastType");

  useEffect(() => {
    if (!message) {
      return;
    }

    const toastKey = `${type}:${message}`;

    if (lastToast.current !== toastKey) {
      if (type === "error") {
        toast.error(message);
      } else {
        toast.success(message);
      }

      lastToast.current = toastKey;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("toast");
    nextParams.delete("toastType");

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [message, pathname, router, searchParams, type]);

  return null;
}
