import { AlertTriangle, ShieldAlert } from "lucide-react";

export default function ModerationWarning({
  blocked,
  onDismiss,
}: {
  blocked: { message: string; categories: string[]; isChildSafety: boolean };
  onDismiss: () => void;
}) {
  const Icon = blocked.isChildSafety ? ShieldAlert : AlertTriangle;
  return (
    <div
      role="alert"
      className={`rounded-md border p-3 text-sm flex gap-3 ${
        blocked.isChildSafety
          ? "border-destructive/60 bg-destructive/10 text-destructive"
          : "border-yellow-600/50 bg-yellow-500/10 text-yellow-200"
      }`}
    >
      <Icon size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium">
          {blocked.isChildSafety ? "Child-safety violation" : "Prompt flagged"}
        </p>
        <p className="mt-1 opacity-90">{blocked.message}</p>
        {blocked.categories.length > 0 && (
          <p className="mt-1 text-xs opacity-75">
            Categories: {blocked.categories.join(", ")}
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-xs opacity-70 hover:opacity-100 self-start"
      >
        Dismiss
      </button>
    </div>
  );
}
