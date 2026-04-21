import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import ModerationWarning from "@/components/ModerationWarning";

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
  const [blocked, setBlocked] = useState<{
    message: string;
    categories: string[];
    isChildSafety: boolean;
  } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ensureSession = useMutation({
    mutationFn: () => apiFetch<{ id: string }>("/assistant/sessions", { method: "POST", body: "{}" }),
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
      body: JSON.stringify({ sessionId, content }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.error === "moderation_blocked") {
        setBlocked({
          message: body.message ?? "Flagged",
          categories: body.categories ?? [],
          isChildSafety: !!body.isChildSafety,
        });
      } else {
        setBlocked({
          message: body.error ?? "Something went wrong",
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
        } catch { /* skip */ }
      }
    }
    setStreaming("");
    qc.invalidateQueries({ queryKey: ["assistant-messages", sessionId] });
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl mx-auto w-full">
        {(messages?.items ?? []).map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {streaming && <MessageBubble role="assistant" content={streaming} />}
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
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Ask for prompt ideas… (1 credit per message)"
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

function MessageBubble({ role, content }: { role: string; content: string }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
          mine ? "bg-primary text-primary-foreground" : "bg-card border border-border"
        }`}
      >
        {content}
      </div>
    </div>
  );
}
