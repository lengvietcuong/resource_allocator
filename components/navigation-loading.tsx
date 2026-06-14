"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type LoadingScope = "content" | "detail";

type NavigationLoadingContextValue = {
  scope: LoadingScope | null;
  startLoading: (scope: LoadingScope) => void;
};

const NavigationLoadingContext = createContext<NavigationLoadingContextValue | null>(null);

export function NavigationLoadingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [scope, setScope] = useState<LoadingScope | null>(null);
  const locationKey = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    queueMicrotask(() => setScope(null));
  }, [locationKey]);

  const value = useMemo(
    () => ({ scope, startLoading: setScope }),
    [scope],
  );

  return (
    <NavigationLoadingContext.Provider value={value}>
      {children}
    </NavigationLoadingContext.Provider>
  );
}

export function useNavigationLoading() {
  const context = useContext(NavigationLoadingContext);

  if (!context) {
    throw new Error("useNavigationLoading must be used inside NavigationLoadingProvider.");
  }

  return context;
}

export function PendingContent({
  when,
  fallback,
  children,
}: {
  when: LoadingScope;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  const { scope } = useNavigationLoading();
  const shouldShowFallback = scope === when;

  return shouldShowFallback ? fallback : children;
}
