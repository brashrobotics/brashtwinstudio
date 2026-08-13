import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type PropsWithChildren } from "react";
import type { TwinApiClient } from "../api/client";
import { IdentityProvider } from "../auth/identity";
import { I18nProvider } from "../i18n/i18n";

export function AppProviders({ children, api }: PropsWithChildren<{ api: TwinApiClient }>) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));
  return (
    <QueryClientProvider client={queryClient}>
      <IdentityProvider>
        <I18nProvider>{children}</I18nProvider>
      </IdentityProvider>
    </QueryClientProvider>
  );
}
