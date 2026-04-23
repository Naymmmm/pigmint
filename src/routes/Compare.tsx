import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCompareArrows, Plus, Trash2, Loader2 } from "lucide-react";
import {
  apiFetch,
  type ComparisonSummary,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ModelCombobox, { type ModelInfo } from "@/components/ModelCombobox";

export default function Compare() {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading } = useQuery<{ items: ComparisonSummary[] }>({
    queryKey: ["comparisons"],
    queryFn: () => apiFetch("/comparisons"),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/comparisons/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparisons"] }),
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-lg bg-primary/10 text-primary">
            <GitCompareArrows size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Comparisons</h1>
            <p className="text-sm text-muted-foreground">
              Benchmark models or pit prompts against each other, side-by-side.
            </p>
          </div>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus size={14} /> New comparison
        </Button>
      </div>

      <Separator />

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (data?.items ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <div className="text-3xl">⚖️</div>
            <h2 className="text-base font-semibold">No comparisons yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Pick 2+ items from the Gallery in selection mode, or run the same
              prompt through multiple models to start.
            </p>
            <div className="pt-2 flex gap-2 justify-center">
              <Button variant="outline" asChild>
                <Link to="/gallery">Go to Gallery</Link>
              </Button>
              <Button onClick={() => setNewOpen(true)}>
                <Plus size={14} /> New comparison
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data!.items.map((c) => (
            <Card key={c.id} className="group relative hover:shadow-lg transition-shadow">
              <Link to={`/compare/${c.id}`} className="block">
                <CardHeader>
                  <CardTitle className="line-clamp-1">{c.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {c.prompt ?? <span className="italic">History-based comparison</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground">
                    {new Date(c.created_at * 1000).toLocaleString()}
                  </div>
                </CardContent>
              </Link>
              <button
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                onClick={() => confirm("Delete this comparison?") && del.mutate(c.id)}
                aria-label="Delete"
              >
                <Trash2 size={14} />
              </button>
            </Card>
          ))}
        </div>
      )}

      <NewComparisonDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function NewComparisonDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("1:1");
  const [slotA, setSlotA] = useState("");
  const [slotB, setSlotB] = useState("");

  const { data: modelsResp } = useQuery<{ items: ModelInfo[] }>({
    queryKey: ["models"],
    queryFn: () => apiFetch("/models?limit=200"),
  });
  const models = modelsResp?.items ?? [];
  const imageModels = useMemo(() => models.filter((m) => m.type === "image"), [models]);

  const run = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/comparisons", {
        method: "POST",
        body: JSON.stringify({
          mode: "prompt",
          name: name.trim(),
          prompt: prompt.trim(),
          aspectRatio: aspect,
          numImages: 1,
          slots: [
            { label: "Model 1", model: slotA },
            { label: "Model 2", model: slotB },
          ],
        }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["comparisons"] });
      onOpenChange(false);
      window.location.href = `/compare/${res.id}`;
    },
  });

  const canSubmit =
    name.trim() && prompt.trim() && slotA && slotB && slotA !== slotB && !run.isPending;

  // Prefer an aspect that all selected models support.
  const aspectOptions = useMemo(() => {
    const a = models.find((m) => m.key === slotA);
    const b = models.find((m) => m.key === slotB);
    if (!a || !b) return ["1:1", "4:3", "3:4", "16:9", "9:16"];
    const set = new Set(a.aspects);
    return b.aspects.filter((x) => set.has(x));
  }, [models, slotA, slotB]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New comparison</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Run one prompt through two models and keep the results in a pinned
          comparison. You can regenerate variants per slot afterwards.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Flux vs GPT Image 2" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Prompt</label>
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A cyberpunk fox at dusk…" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Model 1</label>
            <ModelCombobox
              models={imageModels.filter((m) => m.key !== slotB)}
              value={slotA}
              onChange={(m) => setSlotA(m.key)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Model 2</label>
            <ModelCombobox
              models={imageModels.filter((m) => m.key !== slotA)}
              value={slotB}
              onChange={(m) => setSlotB(m.key)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Aspect</label>
            <Select value={aspect} onValueChange={setAspect}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {aspectOptions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => canSubmit && run.mutate()} disabled={!canSubmit}>
            {run.isPending && <Loader2 size={14} className="animate-spin" />}
            Run comparison
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

