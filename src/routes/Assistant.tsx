import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import ModerationWarning from "@/components/ModerationWarning";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FORMATS = [
  { key: "natural", label: "Natural" },
  { key: "markdown", label: "Markdown" },
  { key: "json", label: "JSON" },
  { key: "yaml", label: "YAML" },
  { key: "xml", label: "XML" },
] as const;

type Format = (typeof FORMATS)[number]["key"];

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
}

export default function Assistant() {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [input, setInput] = useState("");
  const [format, setFormat] = useState<Format>("natural");
  const [blocked, setBlocked] = useState<{
    message: string;
    categories: string[];
    isChildSafety: boolean;
  } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ensureSession = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/assistant/sessions", { method: "POST", body: "{}" }),
    onSuccess: (d) => setSessionId(d.id),
  });

  useEffect(() => {
    if (!sessionId) ensureSession.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: messages } = useQuery<{ items: Message[] }>({
    queryKey: ["assistant-messages", sessionId],
    queryFn: () => apiFetch(`/assistant/sessions/${sessionId}/messages`),
    enabled: !!sessionId,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send() {
    if (!input.trim() || !sessionId) return;
    const content = input.trim();
    setInput("");
    setStreaming("");

    const res = await fetch("/api/assistant/messages", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, content, format }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.error === "moderation_blocked") {
        setBlocked({
          message: body.message ?? "Flagged",
          categories: body.categories ?? [],
          isChildSafety: !!body.isChildSafety,
        });
      } else if (body.error === "paid_plan_required") {
        setBlocked({
          message: "The assistant is a Pro-plan benefit. Upgrade from Settings → Billing.",
          categories: [],
          isChildSafety: false,
        });
      } else {
        setBlocked({
          message: body.detail || body.error || "Something went wrong",
          categories: [],
          isChildSafety: false,
        });
      }
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data) as { delta?: string };
          if (parsed.delta) {
            acc += parsed.delta;
            setStreaming(acc);
          }
        } catch {
          /* skip */
        }
      }
    }
    setStreaming("");
    qc.invalidateQueries({ queryKey: ["assistant-messages", sessionId] });
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b border-border p-3 max-w-3xl mx-auto w-full flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Output format
        </span>
        <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
          <SelectTrigger className="h-8 min-w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMATS.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Free for Pro subscribers
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl mx-auto w-full">
        {(messages?.items ?? []).length === 0 && !streaming && (
          <EmptyHint />
        )}
        {(messages?.items ?? []).map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {streaming && <MessageBubble role="assistant" content={streaming} streaming />}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-4 max-w-3xl mx-auto w-full">
        {blocked && (
          <div className="mb-2">
            <ModerationWarning blocked={blocked} onDismiss={() => setBlocked(null)} />
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())
            }
            placeholder="Describe what you want to create — I'll craft the prompt."
            className="flex-1 bg-input border border-border rounded-md px-3 py-2 text-sm"
          />
          <button
            onClick={send}
            disabled={!input.trim() || !sessionId}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="text-center text-sm text-muted-foreground py-20 space-y-2">
      <p className="text-base text-foreground">Prompt engineering assistant</p>
      <p>Describe the image or video you want. I'll return a production-ready prompt.</p>
      <p className="text-xs">Switch output format above for JSON / YAML / XML / Markdown.</p>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  streaming,
}: {
  role: string;
  content: string;
  streaming?: boolean;
}) {
  const mine = role === "user";
  return (
    <div className={`flex group ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          mine ? "bg-primary text-primary-foreground" : "bg-card border border-border"
        }`}
      >
        {content}
        {streaming && (
          <span className="inline-block ml-0.5 w-[7px] h-3.5 align-baseline bg-current opacity-60 animate-pulse" />
        )}
        {!mine && content && !streaming && <CopyButton text={content} />}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      onClick={copy}
      title="Copy"
      className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
