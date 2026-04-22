import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Folder } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Folder as FolderIcon, Plus } from "lucide-react";
import { useState } from "react";

export default function FolderTree({
  folders,
  activeId,
  onSelect,
}: {
  folders: Folder[];
  activeId?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: (n: string) =>
      apiFetch<{ folder: Folder }>("/folders", {
        method: "POST",
        body: JSON.stringify({ name: n }),
      }),
    onSuccess: (data) => {
      setName("");
      setCreating(false);
      qc.setQueryData<{ items: Folder[] }>(["folders"], (current) => {
        const items = current?.items ?? [];
        const next = [
          ...items.filter((folder) => folder.id !== data.folder.id),
          data.folder,
        ].sort((a, b) => a.name.localeCompare(b.name));
        return { items: next };
      });
      onSelect(data.folder.id);
      qc.invalidateQueries({ queryKey: ["folders"] });
    },
  });

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Folders
        </span>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setCreating(true)}
          aria-label="New folder"
        >
          <Plus size={14} />
        </button>
      </div>

      <FolderRow
        label="All"
        active={activeId === undefined}
        onClick={() => onSelect(undefined)}
      />
      {folders.map((f) => (
        <FolderRow
          key={f.id}
          label={f.name}
          active={activeId === f.id}
          onClick={() => onSelect(f.id)}
        />
      ))}

      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim());
          }}
          className="mt-2"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name && setCreating(false)}
            placeholder="Folder name"
            className="w-full bg-input rounded px-2 py-1 text-sm border border-border"
          />
        </form>
      )}
    </div>
  );
}

function FolderRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
      )}
    >
      <FolderIcon size={14} />
      {label}
    </button>
  );
}
