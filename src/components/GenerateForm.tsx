import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { CreditCard, ImageUp, Maximize2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import ModerationWarning from "./ModerationWarning";
import PresetPicker from "./PresetPicker";
import PromptEditor from "./PromptEditor";
import { PRESETS, applyPreset, applyNegativePreset } from "@/lib/presets";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import ModelCombobox from "./ModelCombobox";

interface ModelInfo {
  key: string;
  label: string;
  type: "image" | "video";
  category?: string | null;
  credits: number;
  aspects: string[];
  defaultAspect: string;
  supportsRefImages: boolean;
  requiresRefImage: boolean;
  numImagesOptions: number[];
  defaultNumImages: number | null;
  resolutionOptions: string[];
  defaultResolution: string | null;
  qualityOptions: string[];
  defaultQuality: string | null;
  isFeatured: boolean;
  featuredRank: number | null;
  hasThumbnail: boolean;
}

interface BillingStatus {
  user: { plan: string; credits: number; free_remaining: number } | null;
}

interface Blocked {
  message: string;
  categories: string[];
  isChildSafety: boolean;
}

interface PaidRequired {
  title: string;
  message: string;
}

export default function GenerateForm({
  folderId,
  onSubmitted,
}: {
  folderId?: string;
  onSubmitted: () => void;
}) {
  const { data: catalog } = useQuery<{ items: ModelInfo[] }>({
    queryKey: ["models"],
    queryFn: () => apiFetch("/models?limit=80"),
    staleTime: 5 * 60_000,
  });
  const models = catalog?.items ?? [];
  const { data: billing } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: () => apiFetch("/billing/status"),
    staleTime: 30_000,
  });

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("flux-schnell");
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [aspect, setAspect] = useState("1:1");
  const [numImages, setNumImages] = useState(1);
  const [resolution, setResolution] = useState("");
  const [quality, setQuality] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [presetKey, setPresetKey] = useState("none");
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [paidRequired, setPaidRequired] = useState<PaidRequired | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const activePreset = PRESETS.find((p) => p.key === presetKey);
  const current =
    selectedModel?.key === model ? selectedModel : models.find((m) => m.key === model);

  useEffect(() => {
    if (!current) return;
    if (!current.aspects.includes(aspect)) {
      setAspect(current.defaultAspect);
    }
    if (current.numImagesOptions.length === 0) {
      setNumImages(1);
    } else if (!current.numImagesOptions.includes(numImages)) {
      setNumImages(current.defaultNumImages ?? current.numImagesOptions[0]);
    }
    if (current.resolutionOptions.length === 0) {
      setResolution("");
    } else if (!current.resolutionOptions.includes(resolution)) {
      setResolution(current.defaultResolution ?? current.resolutionOptions[0]);
    }
    if (current.qualityOptions.length === 0) {
      setQuality("");
    } else if (!current.qualityOptions.includes(quality)) {
      setQuality(current.defaultQuality ?? current.qualityOptions[0]);
    }
  }, [current, aspect, numImages, resolution, quality]);

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; ids?: string[]; submitted?: number; failed?: number }>(
        "/generations",
        {
        method: "POST",
        body: JSON.stringify({
          prompt: applyPreset(prompt, activePreset),
          negativePrompt: applyNegativePreset(undefined, activePreset),
          model,
          aspectRatio: aspect,
          refImageUrls: refs,
          folderId: folderId ?? null,
          numImages: current?.numImagesOptions.length ? numImages : undefined,
          resolution: current?.resolutionOptions.length ? resolution : undefined,
          quality: current?.qualityOptions.length ? quality : undefined,
        }),
      },
      ),
    onSuccess: () => {
      setPrompt("");
      setBlocked(null);
      setFormError(null);
      setPaidRequired(null);
      onSubmitted();
    },
    onError: (err) => {
      const e = err as {
        status?: number;
        body?: {
          error?: string;
          message?: string;
          categories?: string[];
          isChildSafety?: boolean;
          required?: number;
        };
      };
      if (e.body?.error === "moderation_blocked") {
        setFormError(null);
        setPaidRequired(null);
        setBlocked({
          message: e.body.message ?? "This prompt was flagged.",
          categories: e.body.categories ?? [],
          isChildSafety: !!e.body.isChildSafety,
        });
      } else if (isPaidRequiredError(e.body?.error)) {
        setBlocked(null);
        setFormError(null);
        setPaidRequired(
          paidRequiredFromError(
            e.body?.error,
            e.body?.required ?? totalCredits,
            freeCreditCap,
          ),
        );
      } else {
        setBlocked(null);
        setPaidRequired(null);
        setFormError(e.body?.message ?? e.body?.error ?? "Something went wrong.");
      }
    },
  });
  const totalCredits =
    current ? current.credits * (current.type === "image" ? numImages : 1) : 0;
  const isFreePlan = billing?.user?.plan === "free";
  const freeCreditCap = 10;
  const freeLocked =
    isFreePlan && (!!current && (current.type === "video" || totalCredits > freeCreditCap));
  const formReady =
    !!prompt.trim() &&
    !submit.isPending &&
    (!current?.requiresRefImage || refs.length > 0);
  function openPaidRequired() {
    setBlocked(null);
    setFormError(null);
    setPaidRequired(
      current?.type === "video"
        ? {
            title: "Paid plan required",
            message: "Video models require a paid plan.",
          }
        : {
            title: "Paid plan required",
            message: `Free generations are limited to ${freeCreditCap} credits or below. This setup needs ${totalCredits} credits.`,
          },
    );
  }

  function handleSubmit() {
    if (!formReady) return;
    if (freeLocked) {
      openPaidRequired();
      return;
    }
    submit.mutate();
  }

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
    <div className="space-y-3 rounded-xl border border-border bg-card/70 p-3 shadow-sm">
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want to create…"
          rows={2}
          className="min-h-[72px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setEditorOpen(true)}
          title="Expand to full-size prompt editor"
          className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Maximize2 size={14} />
        </motion.button>
      </div>

        <PresetPicker value={presetKey} onChange={setPresetKey} modelType={current?.type} />

      <div className="flex flex-wrap items-end gap-2">
        <LabeledControl label="Model">
          <ModelCombobox
            models={models}
            value={model}
            onChange={(next) => {
              setModel(next.key);
              setSelectedModel(next);
            }}
            isFreePlan={isFreePlan}
            freeCreditCap={freeCreditCap}
          />
        </LabeledControl>

        <LabeledControl label="Aspect">
          <Select value={aspect} onValueChange={setAspect} disabled={!current}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(current?.aspects ?? ["1:1"]).map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledControl>

        {current && current.numImagesOptions.length > 0 && (
          <LabeledControl label="Count">
            <Select
              value={String(numImages)}
              onValueChange={(value) => setNumImages(Number(value))}
            >
              <SelectTrigger className="w-[92px]" title="Number of images">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {current.numImagesOptions.map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {count} img
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LabeledControl>
        )}

        {current && current.resolutionOptions.length > 0 && (
          <LabeledControl label="Resolution">
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger className="w-[104px]" title="Resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {current.resolutionOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LabeledControl>
        )}

        {current && current.qualityOptions.length > 0 && (
          <LabeledControl label="Quality">
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger className="w-[116px]" title="Quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {current.qualityOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LabeledControl>
        )}

        {current?.supportsRefImages && (
          <LabeledControl label="Reference">
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadRef(e.target.files[0])}
              />
              <ImageUp size={14} />
              {current.requiresRefImage ? "Required" : "Upload"}
            </label>
          </LabeledControl>
        )}

        <AnimatePresence>
          {refs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex gap-1.5"
            >
              {refs.map((url, i) => (
                <motion.div
                  key={url}
                  layout
                  className="relative w-9 h-9 rounded-md overflow-hidden border border-border"
                >
                  <img src={url} alt="ref" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setRefs((r) => r.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 bg-background border border-border rounded-full p-0.5 opacity-0 hover:opacity-100 group-hover:opacity-100"
                    aria-label="Remove"
                  >
                    <X size={10} />
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          disabled={!formReady}
          onClick={handleSubmit}
          className="ml-auto h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submit.isPending
            ? "Submitting…"
            : freeLocked
              ? `Locked · ${totalCredits}c`
              : `Generate${totalCredits ? ` · ${totalCredits}c` : ""}`}
        </motion.button>
      </div>

      {freeLocked && (
        <p className="text-xs text-muted-foreground">
          Free generations are limited to image models at {freeCreditCap} credits or below.
        </p>
      )}

      {formError && (
        <p role="alert" className="text-xs text-destructive">
          {formError}
        </p>
      )}

      <AnimatePresence>
        {blocked && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <ModerationWarning blocked={blocked} onDismiss={() => setBlocked(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      <PromptEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        prompt={prompt}
        onPromptChange={setPrompt}
        presetKey={presetKey}
        onPresetKeyChange={setPresetKey}
        modelType={current?.type}
      />

      <BillingRequiredDialog
        paidRequired={paidRequired}
        onOpenChange={(open) => !open && setPaidRequired(null)}
      />
    </div>
  );
}

function isPaidRequiredError(error?: string) {
  return (
    error === "free_generation_credit_cap" ||
    error === "video_requires_paid_plan" ||
    error === "insufficient_credits" ||
    error === "paid_plan_required"
  );
}

function paidRequiredFromError(
  error: string | undefined,
  requiredCredits: number,
  freeCreditCap: number,
): PaidRequired {
  if (error === "insufficient_credits") {
    return {
      title: "More credits required",
      message: `This generation needs ${requiredCredits} credits. Add credits to continue.`,
    };
  }
  if (error === "video_requires_paid_plan" || error === "paid_plan_required") {
    return {
      title: "Paid plan required",
      message: "This model requires a paid plan.",
    };
  }
  return {
    title: "Paid plan required",
    message: `Free generations are limited to ${freeCreditCap} credits or below. This setup needs ${requiredCredits} credits.`,
  };
}

function BillingRequiredDialog({
  paidRequired,
  onOpenChange,
}: {
  paidRequired: PaidRequired | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!paidRequired} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <CreditCard size={18} />
        </div>
        <div className="space-y-2">
          <DialogTitle>{paidRequired?.title ?? "Paid plan required"}</DialogTitle>
          <DialogDescription>
            {paidRequired?.message ?? "Upgrade or add credits to continue."}
          </DialogDescription>
        </div>
        <Link
          to="/settings/billing"
          onClick={() => onOpenChange(false)}
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open billing
        </Link>
      </DialogContent>
    </Dialog>
  );
}

function LabeledControl({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium leading-none text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
