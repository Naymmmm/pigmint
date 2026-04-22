import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Generation } from "@/lib/api";

function aspectValue(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return 1;
  return w / h;
}

function cssAspect(aspect: string): string {
  const [w, h] = aspect.split(":").map((s) => s.trim());
  return w && h ? `${w} / ${h}` : "1 / 1";
}

// Items at or above this index are considered above-the-fold on a typical
// laptop — they get fetch priority + eager loading. Everything past this
// index is deferred (native lazy for images, IntersectionObserver for video).
const EAGER_COUNT = 6;

export default function BentoGrid({ items }: { items: Generation[] }) {
  return (
    <motion.div
      layout
      className={cn(
        "gap-3 columns-2 md:columns-3 lg:columns-4 xl:columns-5 [column-fill:balance]",
      )}
    >
      <AnimatePresence mode="popLayout">
        {items.map((g, i) => (
          <BentoItem key={g.id} gen={g} index={i} eager={i < EAGER_COUNT} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function BentoItem({
  gen,
  index,
  eager,
}: {
  gen: Generation;
  index: number;
  eager: boolean;
}) {
  const isCompleted = gen.status === "completed" && gen.r2_key;
  const isVideo = gen.type === "video";
  const ratio = cssAspect(gen.aspect_ratio);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 32,
        delay: Math.min(index * 0.015, 0.25),
      }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      style={{ aspectRatio: ratio }}
      className={cn(
        "mb-3 block break-inside-avoid rounded-xl overflow-hidden bg-card border border-border relative group",
        "shadow-sm hover:shadow-xl hover:shadow-primary/5",
        "transition-shadow duration-200",
        aspectValue(gen.aspect_ratio) > 2 && "min-h-[80px]",
      )}
    >
      <Link to={`/generation/${gen.id}`} className="block w-full h-full">
        {isCompleted ? (
          isVideo ? (
            <LazyVideo genId={gen.id} />
          ) : (
            <img
              src={`/api/generations/${gen.id}/thumb?w=400`}
              srcSet={`/api/generations/${gen.id}/thumb?w=300 300w, /api/generations/${gen.id}/thumb?w=600 600w`}
              sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 20vw"
              alt={gen.prompt}
              className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
              loading={eager ? "eager" : "lazy"}
              fetchPriority={eager ? "high" : "low"}
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

/**
 * Videos don't honor <img loading="lazy">, and a naked <video src> starts
 * downloading metadata + buffering immediately. We gate by viewport via
 * IntersectionObserver: show a silent placeholder until the tile scrolls
 * near the user, then mount the real <video> with preload="metadata".
 * On hover the video plays; on mouse-out it pauses.
 */
function LazyVideo({ genId }: { genId: string }) {
  const [visible, setVisible] = useState(false);
  const placeholderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible) return;
    const el = placeholderRef.current;
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
      { rootMargin: "200px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  if (!visible) {
    return (
      <div
        ref={placeholderRef}
        className="w-full h-full bg-muted/30 flex items-center justify-center"
      >
        <div className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-white/70">
            <path d="M3 2l7 4-7 4z" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <video
      src={`/api/generations/${genId}/asset`}
      className="w-full h-full object-cover"
      muted
      loop
      playsInline
      preload="metadata"
      onMouseOver={(e) => e.currentTarget.play().catch(() => {})}
      onMouseOut={(e) => e.currentTarget.pause()}
    />
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
