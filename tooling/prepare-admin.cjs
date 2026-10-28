const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const dist = path.join(path.dirname(require.resolve('decap-cms/package.json')), 'dist');
  const dest = path.resolve('public/admin/vendor');
  await fs.mkdir(dest, { recursive: true });
  // Keep lazy-loaded chunks and WASM beside the bundle; no external CDN needed.
  for (const name of await fs.readdir(dist)) {
    if (name.endsWith('.map') || /(?:^|\.)cms\.js(?:\.LICENSE\.txt)?$/.test(name)) continue;
    await fs.copyFile(path.join(dist, name), path.join(dest, name));
  }
  for (const name of ['_headers', '_routes.json']) await fs.copyFile(path.join('source', name), path.join('public', name));
  console.log('Decap CMS assets prepared at /admin/');
})().catch(error => { console.error(error); process.exitCode = 1; });
