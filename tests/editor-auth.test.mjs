import test from "node:test";
import assert from "node:assert/strict";
import { login, authenticated } from "../outputs/cloudflare/editor-auth.mjs";
test("editor password creates a persistent signed cookie and rejects wrong or forged access", async () => {
  const env = { EDITOR_PASSWORD: "test-password-only" };
  const request = (password) =>
    new Request("https://editor.test/api/editor/login", {
      method: "POST",
      headers: {
        Origin: "https://editor.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
  assert.equal((await login(request("wrong"), env)).status, 401);
  const result = await login(request(env.EDITOR_PASSWORD), env);
  assert.equal(result.status, 200);
  const cookie = result.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict; Max-Age=2592000/);
  const session = new Request("https://editor.test/", {
    headers: { Cookie: cookie.split(";")[0] },
  });
  assert.equal(await authenticated(session, env), true);
  assert.equal(
    await authenticated(session, { EDITOR_PASSWORD: "rotated" }),
    false,
  );
  assert.equal(
    await authenticated(new Request("https://editor.test/"), env),
    false,
  );
  assert.equal(
    (
      await login(
        new Request("https://editor.test/api/editor/login", {
          method: "POST",
          headers: { Origin: "https://other.test" },
        }),
        env,
      )
    ).status,
    403,
  );
});
