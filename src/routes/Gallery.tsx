import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Generation, type Folder } from "@/lib/api";
import BentoGrid from "@/components/BentoGrid";
import FilterBar, { type GalleryFilters } from "@/components/FilterBar";
import GenerateForm from "@/components/GenerateForm";
import FolderTree from "@/components/FolderTree";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitCompareArrows, CheckSquare, X, Loader2, Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Gallery() {
  const [filters, setFilters] = useState<GalleryFilters>({});
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(true);
  // Track scroll on the bento container. Near top → expand; scrolled → collapse.
  // Keeping a small hysteresis (expand <= 8px, collapse >= 80px) avoids the
  // form flickering when the user scroll-drifts right at the boundary.
  const onGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    setFormOpen((prev) => (prev ? y < 80 : y <= 8));
  }, []);

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

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const createCompare = useMutation({
    mutationFn: async (name: string) => {
      const ids = Array.from(selected);
      // Group by source model so "Model A" vs "Model B" is the default framing.
      const all = (data?.items ?? []).filter((g) => selected.has(g.id));
      const byModel = new Map<string, string[]>();
      for (const g of all) {
        const arr = byModel.get(g.model) ?? [];
        arr.push(g.id);
        byModel.set(g.model, arr);
      }
      const slots =
        byModel.size >= 2
          ? Array.from(byModel.values()).map((generationIds, i) => ({
              label: `Model ${i + 1}`,
              generationIds,
            }))
          : // Fallback: each selected generation becomes its own slot so the user
            // can still pin arbitrary images side-by-side.
            ids.map((gid, i) => ({
              label: `Slot ${i + 1}`,
              generationIds: [gid],
            }));
      return apiFetch<{ id: string }>("/comparisons", {
        method: "POST",
        body: JSON.stringify({ mode: "history", name, slots }),
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["comparisons"] });
      setCompareOpen(false);
      exitSelection();
      navigate(`/compare/${res.id}`);
    },
  });

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <aside className="w-60 border-r border-border p-4 overflow-y-auto shrink-0">
        <FolderTree
          folders={folders?.items ?? []}
          activeId={filters.folderId}
          onSelect={(id) => setFilters((f) => ({ ...f, folderId: id }))}
        />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 pt-4 space-y-4">
          <AnimatePresence initial={false}>
            {formOpen && (
              <motion.div
                key="gen-card"
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <Card>
                  <CardContent className="pt-5">
                    <GenerateForm
                      folderId={filters.folderId}
                      onSubmitted={() => refetch()}
                    />
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <FilterBar value={filters} onChange={setFilters} />
            <div className="flex items-center gap-2">
              {!formOpen && (
                <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
                  <Plus size={14} /> New
                </Button>
              )}
              {selectionMode ? (
                <>
                  <Badge variant="secondary" className="gap-1">
                    {selected.size} selected
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => setCompareOpen(true)}
                    disabled={selected.size < 2}
                  >
                    <GitCompareArrows size={14} />
                    Compare
                  </Button>
                  <Button size="sm" variant="ghost" onClick={exitSelection}>
                    <X size={14} />
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
                  <CheckSquare size={14} />
                  Select to compare
                </Button>
              )}
            </div>
          </div>
          <Separator />
        </div>

        <div
          className="flex-1 overflow-y-auto px-4 pb-4 pt-2"
          onScroll={onGridScroll}
        >
          {isLoading ? (
            <LoadingGrid />
          ) : (data?.items ?? []).length === 0 ? (
            <EmptyState />
          ) : (
            <BentoGrid
              items={data!.items}
              selectionMode={selectionMode}
              selectedIds={selected}
              onToggleSelect={toggleSelect}
            />
          )}
        </div>
      </div>

      <CreateCompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        count={selected.size}
        onSubmit={(name) => createCompare.mutate(name)}
        pending={createCompare.isPending}
      />
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="gap-3 columns-2 md:columns-3 lg:columns-4 xl:columns-5 [column-fill:balance]">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="mb-3 rounded-xl bg-muted animate-pulse"
          style={{ aspectRatio: i % 3 === 0 ? "3 / 4" : i % 3 === 1 ? "1 / 1" : "4 / 3" }}
        />
      ))}
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

function CreateCompareDialog({
  open,
  onOpenChange,
  count,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  onSubmit: (name: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as comparison</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Group the {count} selected {count === 1 ? "item" : "items"} by model into
          comparison slots. You can regenerate variants per slot afterwards.
        </p>
        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <Input
            autoFocus
            value={name}
            placeholder="e.g. Flux vs GPT Image 2 — castle"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (name.trim()) onSubmit(name.trim());
            }}
            disabled={!name.trim() || pending}
          >
            {pending && <Loader2 size={14} className="animate-spin" />}
            Save comparison
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
