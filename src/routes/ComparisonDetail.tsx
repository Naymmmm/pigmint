import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Layers, Loader2 } from "lucide-react";
import {
  apiFetch,
  type ComparisonDetail,
  type Generation,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function ComparisonDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery<ComparisonDetail>({
    queryKey: ["comparison", id],
    queryFn: () => apiFetch(`/comparisons/${id}`),
    // Poll while any slot has an in-flight generation.
    refetchInterval: (q) => {
      const busy = (q.state.data?.slots ?? []).some((s) =>
        s.generations.some((g) => g.status === "queued" || g.status === "running"),
      );
      return busy ? 2000 : false;
    },
  });

  if (isLoading || !data) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
      <Link to="/compare" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> All comparisons
      </Link>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
        {data.prompt && (
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            <span className="italic">“{data.prompt}”</span>
          </p>
        )}
      </div>

      <Separator />

      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${Math.min(data.slots.length, 3)}, minmax(0, 1fr))`,
        }}
      >
        {data.slots.map((slot) => (
          <SlotColumn
            key={slot.id}
            comparisonId={data.id}
            slotId={slot.id}
            label={slot.label}
            model={slot.model}
            canRun={Boolean(data.prompt && slot.model)}
            generations={slot.generations as Generation[]}
          />
        ))}
      </div>

      {data.slots.length > 3 && (
        <p className="text-xs text-muted-foreground">
          {data.slots.length} slots · scroll horizontally on smaller screens.
        </p>
      )}
    </div>
  );
}

function SlotColumn({
  comparisonId,
  slotId,
  label,
  model,
  canRun,
  generations,
}: {
  comparisonId: string;
  slotId: string;
  label: string;
  model: string | null;
  canRun: boolean;
  generations: Generation[];
}) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(
    generations[generations.length - 1]?.id ?? null,
  );
  const activeGen =
    generations.find((g) => g.id === activeId) ??
    generations[generations.length - 1] ??
    null;

  const run = useMutation({
    mutationFn: () =>
      apiFetch(`/comparisons/${comparisonId}/slots/${slotId}/run`, {
        method: "POST",
        body: JSON.stringify({ numImages: 1 }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparison", comparisonId] }),
  });

  return (
    <Card className="flex flex-col min-h-[320px]">
      <CardContent className="p-4 space-y-3 flex-1 flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge>{label}</Badge>
            {model && (
              <span className="text-xs text-muted-foreground truncate" title={model}>
                {model}
              </span>
            )}
          </div>
          {canRun && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run.mutate()}
              disabled={run.isPending}
            >
              {run.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Regenerate
            </Button>
          )}
        </div>

        <div className="rounded-lg overflow-hidden bg-muted/30 border border-border flex-1 grid place-items-center min-h-[260px]">
          {activeGen ? (
            <GenerationPreview gen={activeGen} />
          ) : (
            <span className="text-xs text-muted-foreground">No output yet.</span>
          )}
        </div>

        {generations.length > 1 && (
          <div className="flex items-center gap-2">
            <Layers size={12} className="text-muted-foreground" />
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {generations.map((g, i) => (
                <button
                  key={g.id}
                  onClick={() => setActiveId(g.id)}
                  className={cn(
                    "relative w-12 h-12 rounded-md overflow-hidden border-2 shrink-0 transition-colors",
                    (activeGen?.id ?? "") === g.id
                      ? "border-primary"
                      : "border-transparent hover:border-border",
                  )}
                  title={`Variant ${i + 1}`}
                >
                  {g.status === "completed" && g.r2_key ? (
                    g.type === "video" ? (
                      <video
                        src={`/api/generations/${g.id}/asset`}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={`/api/generations/${g.id}/thumb?w=120`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    )
                  ) : (
                    <div className="w-full h-full grid place-items-center bg-muted">
                      {g.status === "failed" ? (
                        <span className="text-[9px] text-destructive">fail</span>
                      ) : (
                        <Loader2 size={12} className="animate-spin text-muted-foreground" />
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GenerationPreview({ gen }: { gen: Generation }) {
  if (gen.status !== "completed" || !gen.r2_key) {
    return (
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        {gen.status === "failed" ? (
          <span className="text-sm text-destructive">Failed</span>
        ) : (
          <>
            <Loader2 size={20} className="animate-spin" />
            <span className="text-xs uppercase tracking-wider">{gen.status}</span>
          </>
        )}
      </div>
    );
  }
  return (
    <Link to={`/generation/${gen.id}`} className="block w-full h-full">
      {gen.type === "video" ? (
        <video
          src={`/api/generations/${gen.id}/asset`}
          className="w-full h-full object-contain"
          controls
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <img
          src={`/api/generations/${gen.id}/asset`}
          alt={gen.prompt}
          className="w-full h-full object-contain"
        />
      )}
    </Link>
  );
}
