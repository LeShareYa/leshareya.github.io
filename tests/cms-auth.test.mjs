import test from 'node:test';
import assert from 'node:assert/strict';
import { auth, callback } from '../lib/cms-auth.mjs';
const origin = 'https://leshareya.com';
const env = { GITHUB_CLIENT_ID: 'test-id', GITHUB_CLIENT_SECRET: 'test-secret' };
async function start() {
  const res = await auth(new Request(`${origin}/api/cms/auth?provider=github`), env);
  const location = new URL(res.headers.get('Location'));
  return { res, location, cookie: res.headers.get('Set-Cookie').split(';')[0] };
}
test('missing secrets fail closed; only production origin and GET allowed', async () => {
  assert.equal((await auth(new Request(`${origin}/api/cms/auth?provider=github`), {})).status, 503);
  assert.equal((await auth(new Request('https://preview.pages.dev/api/cms/auth?provider=github'), env)).status, 403);
  assert.equal((await auth(new Request(`${origin}/api/cms/auth?provider=github`, {method:'POST'}), env)).status, 405);
});
test('authorization uses PKCE, exact callback and secure short-lived cookie', async () => {
  const {res,location} = await start();
  assert.equal(res.status,302);
  assert.equal(location.origin,'https://github.com');
  assert.equal(location.searchParams.get('redirect_uri'),`${origin}/api/cms/callback`);
  assert.equal(location.searchParams.get('code_challenge_method'),'S256');
  assert.equal(location.searchParams.get('scope'),'public_repo');
  for(const flag of ['HttpOnly','Secure','SameSite=Lax','Max-Age=600']) assert.ok(res.headers.get('Set-Cookie').includes(flag));
});
test('missing and mismatched state never exchange a token', async () => {
  const {cookie} = await start();
  for (const headers of [{},{Cookie:cookie}]) {
    const res = await callback(new Request(`${origin}/api/cms/callback?code=x&state=wrong`,{headers}),env,()=>{throw Error('must not call');});
    assert.equal(res.status,400);
  }
});
test('successful login validates write permission and restricts token delivery', async () => {
  const {cookie,location} = await start();let calls=0;
  const res=await callback(new Request(`${origin}/api/cms/callback?code=ok&state=${location.searchParams.get('state')}`,{headers:{Cookie:cookie}}),env,async (url,opts)=>{
    calls++;
    if(calls===1){const body=JSON.parse(opts.body);assert.equal(body.client_secret,env.GITHUB_CLIENT_SECRET);assert.ok(body.code_verifier);return Response.json({access_token:'dummy-token'});}
    assert.equal(url,'https://api.github.com/repos/LeShareYa/leshareya.github.io');
    return Response.json({permissions:{push:true}});
  });
  assert.equal(res.status,200);assert.equal(calls,2);
  const html=await res.text();assert.ok(html.includes('event.source !== window.opener'));assert.ok(html.includes('event.origin !== origin'));
  assert.ok(!html.includes('test-secret'));assert.equal(res.headers.get('Cache-Control'),'no-store');
  assert.ok(res.headers.get('Set-Cookie').includes('Max-Age=0'));
});
test('accounts without write access do not receive a CMS token',async()=>{
  const {cookie,location}=await start();let calls=0;
  const res=await callback(new Request(`${origin}/api/cms/callback?code=ok&state=${location.searchParams.get('state')}`,{headers:{Cookie:cookie}}),env,async()=>Response.json(++calls===1?{access_token:'dummy-token'}:{permissions:{push:false}}));
  assert.equal(res.status,403);assert.ok(!(await res.text()).includes('dummy-token'));
});
