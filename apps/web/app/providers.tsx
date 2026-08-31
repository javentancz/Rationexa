"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { reportClientError } from "./monitoring";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          refetchOnMount: false,
          retry: 1,
          staleTime: 5 * 60_000,
          gcTime: 30 * 60_000,
        },
        mutations: { retry: 0 },
      },
    }),
  );

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      void reportClientError(event.error ?? new Error(event.message), { category: "global_error", component: "window" });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      void reportClientError(event.reason, { category: "unhandled_rejection", component: "window" });
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={450} skipDelayDuration={150}>
          {children}
          <Toaster position="bottom-right" richColors closeButton theme="system" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
