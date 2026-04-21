import { cn } from "@/lib/utils";

export interface GalleryFilters {
  type?: "image" | "video";
  folderId?: string;
  bookmarked?: boolean;
}

export default function FilterBar({
  value,
  onChange,
}: {
  value: GalleryFilters;
  onChange: (v: GalleryFilters) => void;
}) {
  const toggle = (patch: Partial<GalleryFilters>) => onChange({ ...value, ...patch });

  return (
    <div className="flex gap-2 items-center flex-wrap">
      <Chip active={!value.type} onClick={() => toggle({ type: undefined })}>
        All
      </Chip>
      <Chip active={value.type === "image"} onClick={() => toggle({ type: "image" })}>
        Images
      </Chip>
      <Chip active={value.type === "video"} onClick={() => toggle({ type: "video" })}>
        Videos
      </Chip>
      <span className="w-px h-5 bg-border mx-1" />
      <Chip
        active={!!value.bookmarked}
        onClick={() => toggle({ bookmarked: !value.bookmarked })}
      >
        ★ Bookmarked
      </Chip>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs border transition",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-transparent border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
