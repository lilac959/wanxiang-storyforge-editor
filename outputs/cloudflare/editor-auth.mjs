const cookieName = "__Host-talespark-editor";
const maxAge = 30 * 24 * 3600;
const attempts = new Map();
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function signature(value, password) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function authenticated(request, env) {
  if (!env.EDITOR_PASSWORD) return false;
  const value = request.headers
    .get("Cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!value) return false;
  const [expiry, nonce, sig] = value.split(".");
  if (
    !/^\d+$/.test(expiry) ||
    Number(expiry) <= Date.now() ||
    Number(expiry) > Date.now() + maxAge * 1000 ||
    !/^[\w-]+$/.test(nonce || "")
  )
    return false;
  return sig === (await signature(`${expiry}.${nonce}`, env.EDITOR_PASSWORD));
}
export function loginPage() {
  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>进入编辑器 · TaleSpark</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5fc;color:#29283d;font:16px system-ui}main{background:white;padding:36px;border:1px solid #e6e2f5;border-radius:18px;width:min(360px,80vw);box-shadow:0 12px 45px #6450a515}h1{font-size:24px}p{color:#77748a;line-height:1.7}label{display:block;margin:24px 0 8px}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:9px;font:inherit}input{border:1px solid #d9d3ee}button{margin-top:18px;border:0;background:#7961ef;color:white;cursor:pointer}#error{color:#bd3b50;font-size:14px}</style><main><h1>TaleSpark 编辑器</h1><p>输入访问密码，开始编辑作品。<br>作品游玩页面无需密码。</p><form><label for="password">访问密码</label><input id="password" type="password" autocomplete="current-password" required autofocus><button>进入编辑器</button><p id="error" role="alert"></p></form></main><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=document.querySelector('button');b.disabled=true;try{const r=await fetch('/api/editor/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.querySelector('input').value})});const d=await r.json();if(!r.ok)throw Error(d.error);location.replace('/');}catch(e){document.querySelector('#error').textContent=e.message;}finally{b.disabled=false;}};</script></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "same-origin",
      },
    },
  );
}
export async function login(request, env) {
  if (request.method !== "POST") return json({ error: "请求方式无效" }, 405);
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    return json({ error: "请从编辑器登录" }, 403);
  if (!env.EDITOR_PASSWORD) return json({ error: "编辑器密码尚未设置" }, 503);
  const ip = request.headers.get("CF-Connecting-IP") || "local",
    now = Date.now();
  let row = attempts.get(ip);
  if (!row || row.until < now) {
    row = { count: 0, until: now + 60000 };
    if (attempts.size > 10000) attempts.clear();
    attempts.set(ip, row);
  }
  if (++row.count > 10)
    return json({ error: "尝试次数较多，请一分钟后重试" }, 429);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: "输入过长" }, 400);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "输入无效" }, 400);
  }
  if (
    typeof body.password !== "string" ||
    (await signature("login", body.password)) !==
      (await signature("login", env.EDITOR_PASSWORD))
  )
    return json({ error: "密码不正确，请重新输入" }, 401);
  attempts.delete(ip);
  const value = `${now + maxAge * 1000}.${crypto.randomUUID()}`;
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": `${cookieName}=${value}.${await signature(value, env.EDITOR_PASSWORD)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
    },
  });
}
