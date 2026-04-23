import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Folder, type Generation } from "@/lib/api";
import {
  ArrowLeft,
  Star,
  Trash2,
  Download,
  RefreshCw,
  Layers,
  Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function GenerationDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: gen } = useQuery<Generation>({
    queryKey: ["generation", id],
    queryFn: () => apiFetch(`/generations/${id}`),
    refetchInterval: (q) =>
      q.state.data && (q.state.data.status === "queued" || q.state.data.status === "running")
        ? 1500
        : false,
  });
  const { data: folders } = useQuery<{ items: Folder[] }>({
    queryKey: ["folders"],
    queryFn: () => apiFetch("/folders"),
  });

  // Sibling variants (including self + regenerations).
  const { data: variants } = useQuery<{ rootId: string; items: Generation[] }>({
    queryKey: ["variants", id],
    queryFn: () => apiFetch(`/generations/${id}/variants`),
    enabled: Boolean(id),
    refetchInterval: (q) =>
      (q.state.data?.items ?? []).some(
        (g) => g.status === "queued" || g.status === "running",
      )
        ? 2000
        : false,
  });

  const bookmark = useMutation({
    mutationFn: () => apiFetch(`/bookmarks/${id}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["generations"] }),
  });
  const del = useMutation({
    mutationFn: () => apiFetch(`/generations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generations"] });
      navigate("/gallery");
    },
  });
  const move = useMutation({
    mutationFn: (value: string) =>
      apiFetch(`/generations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ folderId: value === "none" ? null : value }),
      }),
    onSuccess: (_data, value) => {
      qc.setQueryData<Generation>(["generation", id], (current) =>
        current
          ? { ...current, folder_id: value === "none" ? null : value }
          : current,
      );
      qc.invalidateQueries({ queryKey: ["generation", id] });
      qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });
  const regenerate = useMutation({
    mutationFn: () =>
      apiFetch<{ ids: string[]; parentGenerationId?: string }>(
        `/generations/${id}/regenerate`,
        { method: "POST", body: JSON.stringify({ numImages: 1 }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variants", id] });
      qc.invalidateQueries({ queryKey: ["generations"] });
    },
  });

  if (!gen) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const variantItems = variants?.items ?? [];
  const showVariantStrip = variantItems.length > 1 || regenerate.isPending;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <Link to="/gallery" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Back
      </Link>

      <div className="rounded-xl overflow-hidden bg-card border border-border">
        {gen.status === "completed" && gen.r2_key ? (
          gen.type === "image" ? (
            <img src={`/api/generations/${gen.id}/asset`} alt={gen.prompt} className="w-full" />
          ) : (
            <video src={`/api/generations/${gen.id}/asset`} controls className="w-full" />
          )
        ) : (
          <div className="aspect-video flex items-center justify-center text-muted-foreground">
            {gen.status}…
          </div>
        )}
      </div>

      {showVariantStrip && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-muted-foreground" />
                <span className="text-sm font-medium">Variants</span>
                <Badge variant="muted" className="ml-1">{variantItems.length}</Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => regenerate.mutate()}
                disabled={regenerate.isPending || gen.status !== "completed"}
              >
                {regenerate.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Regenerate
              </Button>
            </div>
            <VariantStrip items={variantItems} activeId={gen.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-5 space-y-4">
          <p className="text-sm">{gen.prompt}</p>
          <div className="flex gap-2 text-xs text-muted-foreground flex-wrap items-center">
            <Badge variant="outline">{gen.model}</Badge>
            <Badge variant="outline">{gen.aspect_ratio}</Badge>
            {gen.width && gen.height && (
              <Badge variant="outline">{gen.width}×{gen.height}</Badge>
            )}
            {gen.variant_index > 0 && (
              <Badge variant="secondary">Variant {gen.variant_index}</Badge>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 min-w-[200px]">
              <span className="text-[11px] font-medium leading-none text-muted-foreground">
                Folder
              </span>
              <Select
                value={gen.folder_id ?? "none"}
                onValueChange={(value) => move.mutate(value)}
                disabled={move.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No folder</SelectItem>
                  {(folders?.items ?? []).map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 ml-auto flex-wrap">
              <Button
                size="sm"
                variant={!showVariantStrip ? "outline" : "ghost"}
                onClick={() => regenerate.mutate()}
                disabled={regenerate.isPending || gen.status !== "completed"}
              >
                {regenerate.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Regenerate
              </Button>
              <Button size="sm" variant="secondary" onClick={() => bookmark.mutate()}>
                <Star size={14} /> Bookmark
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href={`/api/generations/${gen.id}/asset`} download>
                  <Download size={14} /> Download
                </a>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => confirm("Delete this generation?") && del.mutate()}
              >
                <Trash2 size={14} /> Delete
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VariantStrip({ items, activeId }: { items: Generation[]; activeId: string }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {items.map((v) => {
        const isActive = v.id === activeId;
        const ready = v.status === "completed" && v.r2_key;
        return (
          <Link
            key={v.id}
            to={`/generation/${v.id}`}
            className={`relative shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 transition-colors ${
              isActive ? "border-primary" : "border-transparent hover:border-border"
            }`}
            title={v.variant_index === 0 ? "Original" : `Variant ${v.variant_index}`}
          >
            {ready ? (
              v.type === "video" ? (
                <video
                  src={`/api/generations/${v.id}/asset`}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  src={`/api/generations/${v.id}/thumb?w=200`}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              )
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                {v.status === "failed" ? (
                  <span className="text-[10px] text-destructive">failed</span>
                ) : (
                  <Loader2 size={14} className="animate-spin text-muted-foreground" />
                )}
              </div>
            )}
            <div className="absolute bottom-1 left-1 text-[10px] font-medium text-white bg-black/60 rounded px-1.5 py-0.5">
              {v.variant_index === 0 ? "Original" : `V${v.variant_index}`}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
