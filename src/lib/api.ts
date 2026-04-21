import { useQuery } from "@tanstack/react-query";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & {
      status: number;
      body: unknown;
    };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Me {
  id: string;
  email: string;
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await apiFetch<Me>("/me");
      } catch (e) {
        if ((e as { status?: number }).status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export interface Generation {
  id: string;
  type: "image" | "video";
  status: "queued" | "running" | "completed" | "failed";
  prompt: string;
  model: string;
  aspect_ratio: string;
  r2_key: string | null;
  thumb_r2_key: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  folder_id: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
}
