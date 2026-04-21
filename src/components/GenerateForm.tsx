import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import ModerationWarning from "./ModerationWarning";

const MODELS = [
  { key: "flux-schnell", label: "Flux Schnell (1 credit)", type: "image" },
  { key: "flux-dev", label: "Flux Dev (3 credits)", type: "image" },
  { key: "flux-pro", label: "Flux Pro (5 credits)", type: "image" },
  { key: "kling-video", label: "Kling 5s video (25 credits)", type: "video" },
  { key: "veo-video", label: "Veo 3 video (60 credits)", type: "video" },
];

const ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];

interface Blocked {
  message: string;
  categories: string[];
  isChildSafety: boolean;
}

export default function GenerateForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("flux-schnell");
  const [aspect, setAspect] = useState("1:1");
  const [refs, setRefs] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<Blocked | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/generations", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          model,
          aspectRatio: aspect,
          refImageUrls: refs,
        }),
      }),
    onSuccess: () => {
      setPrompt("");
      setBlocked(null);
      onSubmitted();
    },
    onError: (err) => {
      const e = err as { status?: number; body?: { error?: string; message?: string; categories?: string[]; isChildSafety?: boolean } };
      if (e.body?.error === "moderation_blocked") {
        setBlocked({
          message: e.body.message ?? "This prompt was flagged.",
          categories: e.body.categories ?? [],
          isChildSafety: !!e.body.isChildSafety,
        });
      } else {
        setBlocked({
          message: e.body?.message ?? e.body?.error ?? "Something went wrong.",
          categories: [],
          isChildSafety: false,
        });
      }
    },
  });

  async function uploadRef(file: File) {
    const res = await fetch("/api/generations/uploads", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
      credentials: "include",
    });
    const { url } = (await res.json()) as { url: string };
    setRefs((r) => [...r, url]);
  }

  return (
    <div className="space-y-3">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what you want to create…"
        rows={2}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm resize-none"
      />
      <div className="flex gap-2 flex-wrap items-center">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="bg-input border border-border rounded-md px-2 py-1.5 text-sm"
        >
          {MODELS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={aspect}
          onChange={(e) => setAspect(e.target.value)}
          className="bg-input border border-border rounded-md px-2 py-1.5 text-sm"
        >
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <label className="text-sm text-muted-foreground cursor-pointer">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadRef(e.target.files[0])}
          />
          + Reference
        </label>
        {refs.length > 0 && (
          <span className="text-xs text-muted-foreground">{refs.length} ref(s)</span>
        )}
        <button
          disabled={!prompt.trim() || submit.isPending}
          onClick={() => submit.mutate()}
          className="ml-auto bg-primary text-primary-foreground text-sm px-4 py-1.5 rounded-md disabled:opacity-50"
        >
          {submit.isPending ? "Submitting…" : "Generate"}
        </button>
      </div>
      {blocked && <ModerationWarning blocked={blocked} onDismiss={() => setBlocked(null)} />}
    </div>
  );
}
