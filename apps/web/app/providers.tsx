"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import { useState } from "react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 },
        mutations: { retry: 0 },
      },
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={450} skipDelayDuration={150}>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
