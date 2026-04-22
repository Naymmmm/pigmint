import { useState } from "react";
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

export interface ModelInfo {
  key: string;
  label: string;
  description: string | null;
  thumbnailUrl: string | null;
  type: "image" | "video";
  category?: string | null;
  credits: number;
  aspects: string[];
  defaultAspect: string;
  supportsRefImages: boolean;
  requiresRefImage: boolean;
  isFeatured: boolean;
  featuredRank: number | null;
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
  onChange: (key: string) => void;
  isFreePlan?: boolean;
  freeCreditCap?: number;
}) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.key === value);

  const featured = models
    .filter((m) => m.isFeatured)
    .sort((a, b) => (a.featuredRank ?? 9999) - (b.featuredRank ?? 9999))
    .slice(0, 12);
  const featuredKeys = new Set(featured.map((m) => m.key));
  const images = models.filter((m) => m.type === "image" && !featuredKeys.has(m.key));
  const videos = models.filter((m) => m.type === "video" && !featuredKeys.has(m.key));

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
              {current.thumbnailUrl && (
                <img
                  src={`/api/models/${encodeURIComponent(current.key)}/thumb?w=48`}
                  alt=""
                  className="w-5 h-5 rounded object-cover shrink-0"
                  decoding="async"
                />
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
          filter={(itemValue, search) => {
            // itemValue is lowercased by cmdk. Match substring anywhere.
            return itemValue.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search models…" autoFocus />
          <CommandList>
            <CommandEmpty>No models match.</CommandEmpty>
            {featured.length > 0 && (
              <CommandGroup heading="Featured">
                {featured.map((m) => (
                  <ModelRow
                    key={m.key}
                    m={m}
                    selected={value === m.key}
                    isFreeLocked={isFreePlan && (m.type === "video" || m.credits > freeCreditCap)}
                    onSelect={() => {
                      onChange(m.key);
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
                      onChange(m.key);
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
                      onChange(m.key);
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
  // Include description + endpoint-like hints in the search value so typing
  // "edit", "turbo", "pro", etc. matches the right model.
  const searchHaystack =
    `${m.label} ${m.key} ${m.category ?? ""} ${m.description ?? ""}`.toLowerCase();

  return (
    <CommandItem value={searchHaystack} onSelect={onSelect}>
      {m.thumbnailUrl ? (
        <img
          src={`/api/models/${encodeURIComponent(m.key)}/thumb?w=72`}
          alt=""
          className="w-8 h-8 rounded object-cover shrink-0"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
          {m.type === "image" ? (
            <ImageIcon size={14} className="text-muted-foreground" />
          ) : (
            <Video size={14} className="text-muted-foreground" />
          )}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate flex items-center gap-1.5">
          {m.isFeatured && <Star size={12} className="text-primary fill-primary/20" />}
          <span className="truncate">{m.label}</span>
        </div>
        {m.description && (
          <div className="text-xs text-muted-foreground line-clamp-1">
            {m.description}
          </div>
        )}
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
