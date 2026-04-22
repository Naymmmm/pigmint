import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Generation } from "@/lib/api";

type BentoSize = "hero" | "wide" | "tall" | "square" | "small";

const SIZE_CLASS: Record<BentoSize, string> = {
  hero: "col-span-2 row-span-2 md:col-span-3 md:row-span-2",
  wide: "col-span-2 row-span-1",
  tall: "col-span-1 row-span-2",
  square: "col-span-1 row-span-1",
  small: "col-span-1 row-span-1",
};

// Rotating pattern — avoids the old "same-aspect-always-same-size" monotony.
// `dense` packing lets the browser fill gaps with later items.
const PATTERN: BentoSize[] = [
  "hero",
  "tall",
  "wide",
  "square",
  "square",
  "tall",
  "wide",
  "square",
  "hero",
  "square",
  "wide",
  "tall",
];

function sizeFor(index: number, aspect: string): BentoSize {
  // Respect strong aspect hints — portrait stays tall, ultra-wide stays wide.
  if (aspect === "9:16" || aspect === "3:4") return "tall";
  if (aspect === "21:9") return "wide";
  return PATTERN[index % PATTERN.length];
}

export default function BentoGrid({ items }: { items: Generation[] }) {
  return (
    <motion.div
      layout
      className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 auto-rows-[120px] md:auto-rows-[140px] gap-3"
      style={{ gridAutoFlow: "dense" }}
    >
      <AnimatePresence mode="popLayout">
        {items.map((g, i) => (
          <BentoItem key={g.id} gen={g} size={sizeFor(i, g.aspect_ratio)} index={i} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function BentoItem({
  gen,
  size,
  index,
}: {
  gen: Generation;
  size: BentoSize;
  index: number;
}) {
  const isCompleted = gen.status === "completed" && gen.r2_key;
  const isVideo = gen.type === "video";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 32,
        delay: Math.min(index * 0.015, 0.25),
      }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className={cn(
        "rounded-xl overflow-hidden bg-card border border-border relative group",
        "shadow-sm hover:shadow-xl hover:shadow-primary/5",
        "transition-shadow duration-200",
        SIZE_CLASS[size],
      )}
    >
      <Link to={`/generation/${gen.id}`} className="block w-full h-full">
        {isCompleted ? (
          isVideo ? (
            <video
              src={`/api/generations/${gen.id}/asset`}
              className="w-full h-full object-cover"
              muted
              loop
              playsInline
              onMouseOver={(e) => e.currentTarget.play().catch(() => {})}
              onMouseOut={(e) => e.currentTarget.pause()}
            />
          ) : (
            <img
              // Cloudflare Image Transformations: srcset covers 1x/2x displays.
              src={`/api/generations/${gen.id}/thumb?w=600`}
              srcSet={`/api/generations/${gen.id}/thumb?w=400 400w, /api/generations/${gen.id}/thumb?w=800 800w, /api/generations/${gen.id}/thumb?w=1200 1200w`}
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 25vw, 16vw"
              alt={gen.prompt}
              className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
              loading="lazy"
              decoding="async"
            />
          )
        ) : gen.status === "failed" ? (
          <div className="w-full h-full flex items-center justify-center text-destructive text-sm">
            Failed
          </div>
        ) : (
          <ShimmerPlaceholder status={gen.status} />
        )}
        <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <p className="text-xs text-white line-clamp-2">{gen.prompt}</p>
          <div className="flex gap-1.5 mt-1.5">
            {isVideo && (
              <span className="text-[10px] uppercase tracking-wider bg-white/10 backdrop-blur-md text-white/80 px-1.5 py-0.5 rounded">
                Video
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function ShimmerPlaceholder({ status }: { status: string }) {
  return (
    <div className="w-full h-full relative overflow-hidden bg-muted/40">
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
        animate={{ x: ["-100%", "100%"] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          {status}
        </span>
      </div>
    </div>
  );
}
