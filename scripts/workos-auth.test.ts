import assert from "node:assert/strict";
import test from "node:test";

import { workosAuthorizationUrl, workosAuthenticateRequest } from "../worker/auth/workos";

test("builds WorkOS AuthKit authorization URL without SDK", () => {
  const url = new URL(
    workosAuthorizationUrl({
      clientId: "client_123",
      redirectUri: "https://app.example.com/api/auth/callback",
    }),
  );

  assert.equal(url.origin, "https://api.workos.com");
  assert.equal(url.pathname, "/user_management/authorize");
  assert.equal(url.searchParams.get("provider"), "authkit");
  assert.equal(url.searchParams.get("client_id"), "client_123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.com/api/auth/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
});

test("builds WorkOS authenticate request without SDK", () => {
  const request = workosAuthenticateRequest({
    apiKey: "sk_test",
    clientId: "client_123",
    code: "abc",
  });

  assert.equal(request.url, "https://api.workos.com/user_management/authenticate");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, {
    Authorization: "Bearer sk_test",
    "Content-Type": "application/json",
  });
  assert.equal(
    request.init.body,
    JSON.stringify({
      grant_type: "authorization_code",
      client_id: "client_123",
      client_secret: "sk_test",
      code: "abc",
    }),
  );
});
