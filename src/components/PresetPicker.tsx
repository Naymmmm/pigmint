import { PRESETS, type Preset } from "@/lib/presets";
import { cn } from "@/lib/utils";

export default function PresetPicker({
  value,
  onChange,
  modelType,
}: {
  value: string;
  onChange: (presetKey: string) => void;
  modelType: "image" | "video" | undefined;
}) {
  const visible = PRESETS.filter(
    (p) => !p.appliesTo || (modelType && p.appliesTo.includes(modelType)),
  );

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5">
      {visible.map((p) => (
        <PresetChip
          key={p.key}
          preset={p}
          active={value === p.key}
          onClick={() => onChange(p.key)}
        />
      ))}
    </div>
  );
}

function PresetChip({
  preset,
  active,
  onClick,
}: {
  preset: Preset;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
      )}
      title={preset.promptSuffix ? `Appends: ${preset.promptSuffix}` : undefined}
    >
      <span aria-hidden>{preset.emoji}</span>
      {preset.label}
    </button>
  );
}
