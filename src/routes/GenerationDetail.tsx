import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Generation } from "@/lib/api";
import { ArrowLeft, Star, Trash2, Download } from "lucide-react";

export default function GenerationDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: gen } = useQuery<Generation>({
    queryKey: ["generation", id],
    queryFn: () => apiFetch(`/generations/${id}`),
    refetchInterval: (q) =>
      q.state.data && (q.state.data.status === "queued" || q.state.data.status === "running")
        ? 1500
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
      window.location.href = "/gallery";
    },
  });

  if (!gen) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <Link to="/gallery" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
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
      <div className="space-y-3">
        <p className="text-sm">{gen.prompt}</p>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span>{gen.model}</span>
          <span>·</span>
          <span>{gen.aspect_ratio}</span>
          {gen.width && gen.height && (
            <>
              <span>·</span>
              <span>{gen.width}×{gen.height}</span>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => bookmark.mutate()}
            className="inline-flex items-center gap-2 bg-secondary text-secondary-foreground px-3 py-1.5 rounded text-sm"
          >
            <Star size={14} /> Bookmark
          </button>
          <a
            href={`/api/generations/${gen.id}/asset`}
            download
            className="inline-flex items-center gap-2 bg-secondary text-secondary-foreground px-3 py-1.5 rounded text-sm"
          >
            <Download size={14} /> Download
          </a>
          <button
            onClick={() => confirm("Delete this generation?") && del.mutate()}
            className="inline-flex items-center gap-2 bg-destructive/20 text-destructive px-3 py-1.5 rounded text-sm ml-auto"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
