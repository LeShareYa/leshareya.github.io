// Decap's popup handshake can lose window.opener after the GitHub redirect.
// A random, single-use channel provides a same-origin fallback without storing tokens.
(() => {
  if (!window.BroadcastChannel || !window.crypto?.getRandomValues) return;
  const originalOpen = window.open;
  window.open = function (url, name, features) {
    let target;
    try { target = new URL(url, location.href); } catch { return originalOpen.apply(this, arguments); }
    if (name !== 'Netlify Authorization' || target.origin !== location.origin || target.pathname !== '/api/cms/auth' || target.searchParams.get('provider') !== 'github') {
      return originalOpen.apply(this, arguments);
    }
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    target.searchParams.set('channel', id);
    const channel = new BroadcastChannel(`cms-auth-${id}`);
    const popup = originalOpen.call(this, target.href, name, features);
    if (!popup) { channel.close(); return popup; }
    const timer = setTimeout(() => channel.close(), 10 * 60 * 1000);
    channel.onmessage = event => {
      const message = event.data;
      if (typeof message !== 'string' || !message.startsWith('authorization:github:success:')) return;
      channel.close();
      clearTimeout(timer);
      // Advance Decap's existing handshake, then deliver the result to its listener.
      window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: popup, data: 'authorizing:github' }));
      window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: popup, data: message }));
    };
    return popup;
  };
})();
