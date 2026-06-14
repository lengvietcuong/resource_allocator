"use client";

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";

import { useNavigationLoading } from "@/components/navigation-loading";
import { cn } from "@/lib/utils";

type PendingLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  href: string;
  scope?: "content" | "detail";
};

export const PendingLink = forwardRef<HTMLAnchorElement, PendingLinkProps>(function PendingLink(
  { href, className, scope = "detail", children, onClick, ...props },
  ref,
) {
  const { startLoading } = useNavigationLoading();

  return (
    <Link
      className={cn(className)}
      href={href}
      onClick={(event) => {
        onClick?.(event);

        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          event.shiftKey
        ) {
          return;
        }

        startLoading(scope);
      }}
      ref={ref}
      {...props}
    >
      {children}
    </Link>
  );
});
