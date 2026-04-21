import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Generation } from "@/lib/api";
import { motion } from "framer-motion";

function spanForAspect(aspect: string): string {
  switch (aspect) {
    case "16:9":
    case "21:9":
      return "col-span-2 row-span-1";
    case "9:16":
    case "3:4":
      return "col-span-1 row-span-2";
    case "4:3":
      return "col-span-2 row-span-2";
    default:
      return "col-span-1 row-span-1";
  }
}

export default function BentoGrid({ items }: { items: Generation[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 auto-rows-[160px] gap-3">
      {items.map((g) => (
        <motion.div
          key={g.id}
          layout
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            "rounded-xl overflow-hidden bg-card border border-border relative group",
            spanForAspect(g.aspect_ratio),
          )}
        >
          <Link to={`/generation/${g.id}`} className="block w-full h-full">
            {g.status === "completed" && g.r2_key ? (
              g.type === "image" ? (
                <img
                  src={`/api/generations/${g.id}/asset`}
                  alt={g.prompt}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <video
                  src={`/api/generations/${g.id}/asset`}
                  className="w-full h-full object-cover"
                  muted
                  loop
                  playsInline
                  onMouseOver={(e) => e.currentTarget.play()}
                  onMouseOut={(e) => e.currentTarget.pause()}
                />
              )
            ) : g.status === "failed" ? (
              <div className="w-full h-full flex items-center justify-center text-destructive text-sm">
                Failed
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs animate-pulse">
                {g.status}…
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition">
              <p className="text-xs text-white line-clamp-2">{g.prompt}</p>
            </div>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
