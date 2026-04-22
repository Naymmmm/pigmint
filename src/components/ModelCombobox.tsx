import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Check, Image as ImageIcon, Lock, Video, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

export interface ModelInfo {
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

export default function ModelCombobox({
  models,
  value,
  onChange,
  isFreePlan = false,
  freeCreditCap = 10,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (model: ModelInfo) => void;
  isFreePlan?: boolean;
  freeCreditCap?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const searchEnabled = open && deferredSearch.length > 0;
  const { data: searchCatalog } = useQuery<{ items: ModelInfo[] }>({
    queryKey: ["models-search", deferredSearch],
    queryFn: () =>
      apiFetch(`/models/search?q=${encodeURIComponent(deferredSearch)}&limit=80`),
    enabled: searchEnabled,
    staleTime: 5 * 60_000,
  });

  // Remember every model we've seen — from the default list, from search
  // results, and whatever the user picks. This lets us resolve `current`
  // even when a model was picked via search and then the popover closed
  // (the default `models` list likely doesn't include it).
  const [knownByKey, setKnownByKey] = useState<Map<string, ModelInfo>>(() => new Map());

  useEffect(() => {
    if (models.length === 0) return;
    setKnownByKey((prev) => {
      const next = new Map(prev);
      for (const m of models) next.set(m.key, m);
      return next;
    });
  }, [models]);

  useEffect(() => {
    const items = searchCatalog?.items;
    if (!items || items.length === 0) return;
    setKnownByKey((prev) => {
      const next = new Map(prev);
      for (const m of items) next.set(m.key, m);
      return next;
    });
  }, [searchCatalog]);

  function rememberPicked(m: ModelInfo) {
    setKnownByKey((prev) => {
      if (prev.has(m.key)) return prev;
      const next = new Map(prev);
      next.set(m.key, m);
      return next;
    });
  }

  const visibleModels = searchEnabled ? searchCatalog?.items ?? [] : models;
  const current = knownByKey.get(value);

  const { featured, images, videos } = useMemo(() => {
    const featuredModels = visibleModels
      .filter((m) => m.isFeatured)
      .sort((a, b) => (a.featuredRank ?? 9999) - (b.featuredRank ?? 9999))
      .slice(0, 12);
    const featuredKeys = new Set(featuredModels.map((m) => m.key));
    return {
      featured: featuredModels,
      images: visibleModels.filter((m) => m.type === "image" && !featuredKeys.has(m.key)),
      videos: visibleModels.filter((m) => m.type === "video" && !featuredKeys.has(m.key)),
    };
  }, [visibleModels]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-input px-3 py-1.5 text-sm",
            "min-w-[280px] max-w-[380px] bg-background shadow-sm focus:outline-none focus:ring-2 focus:ring-ring",
            "transition-colors hover:border-muted-foreground/40",
            "data-[state=open]:border-primary/50",
          )}
          aria-expanded={open}
        >
          {current ? (
            <span className="flex items-center gap-2 min-w-0">
              {current.hasThumbnail && (
                <ModelThumbnail m={current} sizeClass="w-5 h-5" width={48} />
              )}
              <span className="truncate">{current.label}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                {current.credits}c
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select model…</span>
          )}
          <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" sideOffset={6}>
        <Command
          shouldFilter={false}
        >
          <CommandInput
            placeholder="Search models…"
            autoFocus
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {searchEnabled && !searchCatalog ? "Searching..." : "No models match."}
            </CommandEmpty>
            {featured.length > 0 && (
              <CommandGroup heading="Featured">
                {featured.map((m) => (
                  <ModelRow
                    key={m.key}
                    m={m}
                    selected={value === m.key}
                    isFreeLocked={isFreePlan && (m.type === "video" || m.credits > freeCreditCap)}
                    onSelect={() => {
                      rememberPicked(m);
                      onChange(m);
                      setSearch("");
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
            {featured.length > 0 && (images.length > 0 || videos.length > 0) && (
              <CommandSeparator />
            )}
            {images.length > 0 && (
              <CommandGroup heading="Images">
                {images.map((m) => (
                  <ModelRow
                    key={m.key}
                    m={m}
                    selected={value === m.key}
                    isFreeLocked={isFreePlan && m.credits > freeCreditCap}
                    onSelect={() => {
                      rememberPicked(m);
                      onChange(m);
                      setSearch("");
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
            {images.length > 0 && videos.length > 0 && <CommandSeparator />}
            {videos.length > 0 && (
              <CommandGroup heading="Videos">
                {videos.map((m) => (
                  <ModelRow
                    key={m.key}
                    m={m}
                    selected={value === m.key}
                    isFreeLocked={isFreePlan}
                    onSelect={() => {
                      rememberPicked(m);
                      onChange(m);
                      setSearch("");
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ModelRow({
  m,
  selected,
  isFreeLocked,
  onSelect,
}: {
  m: ModelInfo;
  selected: boolean;
  isFreeLocked: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={m.key} onSelect={onSelect}>
      {m.hasThumbnail ? (
        <ModelThumbnail m={m} sizeClass="w-8 h-8" width={72} lazy />
      ) : (
        <ModelPlaceholder m={m} sizeClass="w-8 h-8" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate flex items-center gap-1.5">
          {m.isFeatured && <Star size={12} className="text-primary fill-primary/20" />}
          <span className="truncate">{m.label}</span>
        </div>
        {m.category && <div className="text-xs text-muted-foreground line-clamp-1">{m.category}</div>}
      </div>
      <div className="text-xs text-muted-foreground shrink-0 tabular-nums">
        {isFreeLocked ? (
          <span className="inline-flex items-center gap-1">
            <Lock size={11} />
            {m.credits}c
          </span>
        ) : (
          `${m.credits}c`
        )}
      </div>
      {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </CommandItem>
  );
}

function ModelThumbnail({
  m,
  sizeClass,
  width,
  lazy = false,
}: {
  m: ModelInfo;
  sizeClass: string;
  width: number;
  lazy?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(!lazy);
  const holderRef = useRef<HTMLDivElement | null>(null);

  // Scroll containers (like the popover list) often defeat the browser's
  // `loading="lazy"` — it only fires near the document viewport, not within
  // an inner scrollable element. IntersectionObserver with the popover's
  // own scroller as the implicit root handles that case.
  useEffect(() => {
    if (!lazy || visible) return;
    const el = holderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "120px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazy, visible]);

  if (!m.hasThumbnail || failed) {
    return <ModelPlaceholder m={m} sizeClass={sizeClass} />;
  }

  if (!visible) {
    return (
      <div
        ref={holderRef}
        className={cn(sizeClass, "rounded bg-muted shrink-0")}
      />
    );
  }

  return (
    <img
      src={modelThumbnailSrc(m.key, width)}
      alt=""
      className={cn(sizeClass, "rounded object-cover shrink-0")}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function modelThumbnailSrc(key: string, width: number) {
  return `/api/models/thumb?key=${encodeURIComponent(key)}&w=${width}`;
}

function ModelPlaceholder({ m, sizeClass }: { m: ModelInfo; sizeClass: string }) {
  return (
    <div className={cn(sizeClass, "rounded bg-muted flex items-center justify-center shrink-0")}>
      {m.type === "image" ? (
        <ImageIcon size={14} className="text-muted-foreground" />
      ) : (
        <Video size={14} className="text-muted-foreground" />
      )}
    </div>
  );
}
