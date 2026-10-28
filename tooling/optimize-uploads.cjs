const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
async function walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(p));
    else if (entry.isFile()) files.push(p);
  }
  return files;
}
(async () => {
  let saved = 0;
  // Process build output only. Original uploads remain available in Git.
  for (const file of await walk('public/images/uploads')) {
    if (!/\.(jpe?g|webp)$/i.test(file)) continue;
    const original = await fs.readFile(file);
    const meta = await sharp(original).metadata();
    if ((meta.pages || 1) > 1) continue;
    let transform = sharp(original).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true });
    transform = /\.webp$/i.test(file) ? transform.webp({ quality: 82 }) : transform.jpeg({ quality: 82, mozjpeg: true });
    const result = await transform.toBuffer();
    if (result.length < original.length) { await fs.writeFile(file, result); saved += original.length - result.length; }
  }
  console.log(`Uploaded photo optimization saved ${saved} bytes; PNG/GIF originals preserved.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
