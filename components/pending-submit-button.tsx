"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function PendingSubmitButton({
  children,
  className,
  variant,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const { pending } = useFormStatus();

  return (
    <Button className={className} loading={pending} type="submit" variant={variant}>
      {children}
    </Button>
  );
}
