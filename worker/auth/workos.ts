const WORKOS_BASE_URL = "https://api.workos.com";

interface AuthorizationOptions {
  clientId: string;
  redirectUri: string;
}

interface AuthenticateOptions {
  apiKey: string;
  clientId: string;
  code: string;
}

interface WorkosUser {
  id: string;
  email: string;
}

export function workosAuthorizationUrl(options: AuthorizationOptions): string {
  const url = new URL("/user_management/authorize", WORKOS_BASE_URL);
  url.searchParams.set("provider", "authkit");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export function workosAuthenticateRequest(options: AuthenticateOptions): {
  url: string;
  init: RequestInit;
} {
  return {
    url: `${WORKOS_BASE_URL}/user_management/authenticate`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: options.clientId,
        client_secret: options.apiKey,
        code: options.code,
      }),
    },
  };
}

export async function authenticateWorkosCode(
  options: AuthenticateOptions,
): Promise<WorkosUser> {
  const request = workosAuthenticateRequest(options);
  const res = await fetch(request.url, request.init);
  if (!res.ok) {
    throw new Error(`workos authenticate failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { user?: { id?: string; email?: string } };
  if (!body.user?.id || !body.user.email) {
    throw new Error("workos authenticate missing user");
  }
  return { id: body.user.id, email: body.user.email };
}
