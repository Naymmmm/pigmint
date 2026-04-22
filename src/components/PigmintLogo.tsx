import { cn } from "@/lib/utils";

export default function PigmintLogo({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold tracking-tight text-foreground",
        size === "lg" ? "text-5xl" : "text-lg",
        className,
      )}
    >
      pig<span className="text-primary">mint</span>
    </span>
  );
}
