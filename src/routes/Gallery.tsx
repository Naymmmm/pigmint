import { useQuery } from "@tanstack/react-query";
import { apiFetch, type Generation, type Folder } from "@/lib/api";
import BentoGrid from "@/components/BentoGrid";
import FilterBar, { type GalleryFilters } from "@/components/FilterBar";
import GenerateForm from "@/components/GenerateForm";
import FolderTree from "@/components/FolderTree";
import { useState } from "react";

export default function Gallery() {
  const [filters, setFilters] = useState<GalleryFilters>({});

  const { data: folders } = useQuery<{ items: Folder[] }>({
    queryKey: ["folders"],
    queryFn: () => apiFetch("/folders"),
  });

  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.folderId) params.set("folderId", filters.folderId);
  if (filters.bookmarked) params.set("bookmarked", "true");
  const qs = params.toString();

  const { data, isLoading, refetch } = useQuery<{
    items: Generation[];
    nextCursor: number | null;
  }>({
    queryKey: ["generations", qs],
    queryFn: () => apiFetch(`/generations${qs ? `?${qs}` : ""}`),
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      return items.some((g) => g.status === "queued" || g.status === "running")
        ? 2000
        : false;
    },
  });

  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r border-border p-4 overflow-y-auto">
        <FolderTree
          folders={folders?.items ?? []}
          activeId={filters.folderId}
          onSelect={(id) => setFilters((f) => ({ ...f, folderId: id }))}
        />
      </aside>
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border p-4 space-y-4">
          <GenerateForm folderId={filters.folderId} onSubmitted={() => refetch()} />
          <FilterBar value={filters} onChange={setFilters} />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : (data?.items ?? []).length === 0 ? (
            <EmptyState />
          ) : (
            <BentoGrid items={data!.items} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <div className="text-5xl mb-4">🎨</div>
      <h2 className="text-xl font-semibold">Nothing here yet</h2>
      <p className="text-muted-foreground max-w-sm mt-2">
        Your generations will land here. Start with a prompt above.
      </p>
    </div>
  );
}
