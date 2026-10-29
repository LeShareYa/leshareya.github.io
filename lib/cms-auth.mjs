const ORIGIN = 'https://leshareya.com';
const CALLBACK = `${ORIGIN}/api/cms/callback`;
const COOKIE = '__Host-cms-oauth';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const cookie = (value, age = 600) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function response(body, status = 400, extra = {}) { return new Response(body, { status, headers: { ...headers, ...extra } }); }
function check(request, env) {
  if (request.method !== 'GET') return response('Method not allowed', 405, { Allow: 'GET' });
  if (new URL(request.url).origin !== ORIGIN) return response('请从 https://leshareya.com/admin/ 登录。', 403);
  const missing = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'].filter(name => !env[name]);
  if (missing.length) return response(`写作后台等待管理员配置 GitHub OAuth。缺少：${missing.join('、')}。请检查 Cloudflare Pages 生产环境配置并重新部署。`, 503);
}
export async function auth(request, env) {
  const invalid = check(request, env); if (invalid) return invalid;
  const provider = new URL(request.url).searchParams.get('provider');
  if (provider !== 'github') return response('Unsupported provider');
  const channel = new URL(request.url).searchParams.get('channel') || '';
  if (channel && !/^[a-f0-9]{48}$/.test(channel)) return response('Invalid channel');
  const state = random(); const verifier = random();
  const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: CALLBACK, scope: 'public_repo', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return response(null, 302, { Location: url.href, 'Set-Cookie': cookie(`${state}.${verifier}.${Date.now()}.${channel}`) });
}
function popup(token, channel) {
  const nonce = random();
  const message = JSON.stringify(`authorization:github:success:${JSON.stringify({ token, provider: 'github' })}`).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>登录成功</title><p>登录成功，正在返回写作后台。</p><script data-cfasync="false" nonce="${nonce}">
const origin = ${JSON.stringify(ORIGIN)};
let delivered = false;
function receive(event) {
  if (event.origin !== origin || event.source !== window.opener || event.data !== 'authorizing:github') return;
  window.removeEventListener('message', receive);
  delivered = true;
  window.opener.postMessage(${message}, origin);
}
window.addEventListener('message', receive);
if (window.opener) window.opener.postMessage('authorizing:github', origin);
const channelId = ${JSON.stringify(channel)};
if (channelId && window.BroadcastChannel) setTimeout(() => {
  if (delivered) return;
  const channel = new BroadcastChannel('cms-auth-' + channelId);
  channel.postMessage(${message});
  channel.close();
  document.querySelector('p').textContent = '登录结果已发送，请返回写作后台。';
  setTimeout(() => window.close(), 1000);
}, 1500);
else if (!window.opener) document.querySelector('p').textContent = '无法自动返回，请关闭此窗口并重新打开写作后台登录。';
</script></html>`;
  return response(html, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': cookie('', 0),
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`
  });
}
export async function callback(request, env, fetcher = fetch) {
  const invalid = check(request, env); if (invalid) return invalid;
  const url = new URL(request.url);
  const value = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  const [state, verifier, timestamp, channel = ''] = value.split('.');
  const fail = (text, status = 400) => response(text, status, { 'Set-Cookie': cookie('', 0) });
  if ((channel && !/^[a-f0-9]{48}$/.test(channel)) || !state || !verifier || !timestamp || !/^\d+$/.test(timestamp) || Number(timestamp) > Date.now() || Date.now() - Number(timestamp) > 600000 || url.searchParams.get('state') !== state) return fail('登录验证已过期或无效，请关闭窗口后重试。');
  if (url.searchParams.has('error') || !url.searchParams.get('code')) return fail('GitHub 登录未完成，请重试。');
  try {
    const exchanged = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get('code'), redirect_uri: CALLBACK, code_verifier: verifier }),
      signal: AbortSignal.timeout(15000)
    });
    if (!exchanged.ok) return fail('GitHub 登录服务暂不可用，请稍后重试。', 502);
    const data = await exchanged.json();
    if (typeof data.access_token !== 'string' || !data.access_token) return fail('GitHub 授权未完成，请重新登录。', 401);
    const repo = await fetcher('https://api.github.com/repos/LeShareYa/leshareya.github.io', {
      headers: { Authorization: `Bearer ${data.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'leshareya-cms' },
      signal: AbortSignal.timeout(15000)
    });
    if (!repo.ok || !(await repo.json()).permissions?.push) return fail('此 GitHub 账号没有博客仓库的写入权限。', 403);
    return popup(data.access_token, channel);
  } catch { return fail('登录服务暂不可用，请稍后重试。', 502); }
}
