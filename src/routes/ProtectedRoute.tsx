import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/api";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProtectedContent>{children}</ProtectedContent>
    </QueryClientProvider>
  );
}

function ProtectedContent({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (!data) {
    window.location.href = "/api/auth/login";
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
