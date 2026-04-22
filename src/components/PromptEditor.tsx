import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, ChevronRight } from "lucide-react";
import { PRESETS, applyPreset } from "@/lib/presets";
import PresetPicker from "./PresetPicker";

// Quick-insert tokens that people commonly append to prompts.
const TOKENS = [
  "highly detailed",
  "cinematic lighting",
  "shallow depth of field",
  "volumetric fog",
  "ultra-sharp focus",
  "rim lighting",
  "dramatic composition",
  "golden hour",
  "studio lighting",
  "film grain",
  "wide-angle lens",
  "bokeh",
  "4K, 8K",
  "trending on artstation",
  "octane render",
  "subsurface scattering",
];

export default function PromptEditor({
  open,
  onOpenChange,
  prompt,
  onPromptChange,
  presetKey,
  onPresetKeyChange,
  modelType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  presetKey: string;
  onPresetKeyChange: (key: string) => void;
  modelType: "image" | "video" | undefined;
}) {
  const [draft, setDraft] = useState(prompt);
  const [localPreset, setLocalPreset] = useState(presetKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync from parent when reopening.
  useEffect(() => {
    if (open) {
      setDraft(prompt);
      setLocalPreset(presetKey);
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(prompt.length, prompt.length);
      }, 50);
    }
  }, [open, prompt, presetKey]);

  const activePreset = PRESETS.find((p) => p.key === localPreset);
  const composed = applyPreset(draft, activePreset);

  function insertToken(token: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setDraft((d) => (d ? `${d}, ${token}` : token));
      return;
    }
    const start = ta.selectionStart ?? draft.length;
    const end = ta.selectionEnd ?? draft.length;
    const before = draft.slice(0, start);
    const after = draft.slice(end);
    const separator = before && !before.endsWith(" ") && !before.endsWith(",") ? ", " : "";
    const next = `${before}${separator}${token}${after}`;
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = before.length + separator.length + token.length;
      ta.setSelectionRange(cursor, cursor);
    });
  }

  function applyAndClose() {
    onPromptChange(draft);
    onPresetKeyChange(localPreset);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose
        className="max-w-4xl w-[92vw] h-[88vh] p-0 gap-0 flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <DialogTitle className="text-base font-medium flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            Prompt editor
          </DialogTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{draft.length} chars</span>
            <span>·</span>
            <span>{draft.trim().split(/\s+/).filter(Boolean).length} words</span>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_280px] overflow-hidden">
          {/* Editor column */}
          <div className="flex flex-col overflow-hidden border-r border-border">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write your prompt. Take your time — this is the big canvas."
              className="flex-1 p-5 bg-transparent text-sm md:text-base leading-relaxed resize-none focus:outline-none font-mono"
              spellCheck={false}
            />
            <div className="border-t border-border p-3 max-h-[38%] overflow-y-auto bg-muted/20">
              <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                <ChevronRight size={12} />
                <span>Final prompt sent to the model</span>
              </div>
              <p className="text-xs leading-relaxed whitespace-pre-wrap">
                {composed || (
                  <span className="text-muted-foreground italic">
                    Start typing to preview…
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Sidebar */}
          <div className="overflow-y-auto p-4 space-y-5 bg-card/40">
            <div>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Style
              </h3>
              <PresetPicker
                value={localPreset}
                onChange={setLocalPreset}
                modelType={modelType}
              />
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Quick insert
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {TOKENS.map((t) => (
                  <motion.button
                    key={t}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => insertToken(t)}
                    className="text-[11px] px-2 py-1 rounded-md border border-border bg-background hover:bg-accent hover:border-muted-foreground/40 transition-colors"
                  >
                    {t}
                  </motion.button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Tips
              </h3>
              <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed">
                <li>• Lead with the subject. Models weight earlier tokens more.</li>
                <li>• Comma-separated phrases beat long sentences.</li>
                <li>• Style + medium + lighting + camera works well.</li>
                <li>• Less is often more — 40–80 tokens is a sweet spot.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-3 border-t border-border bg-card/60">
          <button
            onClick={() => onOpenChange(false)}
            className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5"
          >
            Cancel
          </button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={applyAndClose}
            className="bg-primary text-primary-foreground text-sm px-4 py-1.5 rounded-md"
          >
            Apply
          </motion.button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
