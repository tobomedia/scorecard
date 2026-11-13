// Builds the deployable site into an output folder (default: _site).
//
// - Copies the app files.
// - Renames app.js / styles.css to content-hashed names (app.3f9a1c2b.js), so a
//   browser or service worker can never serve an old file under a new version.
// - Rewrites index.html and sw.js to point at the hashed names.
// - Stamps a version into sw.js (cache name) and index.html (shown on the home screen),
//   so installed phones always see a new service worker when anything changes.
//
// Usage: node scripts/build.mjs [outDir]
// Env:   BUILD_NUMBER (optional, e.g. GitHub run number) is shown in the version label.

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] || '_site');

const STATIC = ['index.html', 'sw.js', 'manifest.webmanifest', 'icons', 'assets'];
const HASHED = ['app.js', 'styles.css'];

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
const read = (f) => readFileSync(join(root, f));

if (root === out || root.startsWith(out + '/')) throw new Error(`build: refusing to overwrite ${out}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of STATIC) cpSync(join(root, f), join(out, f), { recursive: true });

// 1. Hashed copies of app.js and styles.css
const renamed = {};
for (const f of HASHED) {
  const buf = read(f);
  const name = `${basename(f, extname(f))}.${hash(buf)}${extname(f)}`;
  writeFileSync(join(out, name), buf);
  renamed[f] = name;
}

// 2. Overall version: hash of every shipped file, so any change produces a new service worker.
const all = createHash('sha256');
const listDir = (d) => readdirSync(join(root, d), { recursive: true }).map((f) => `${d}/${f}`).filter((f) => extname(f));
const files = [...HASHED, 'index.html', 'manifest.webmanifest', ...listDir('icons'), ...listDir('assets')];

// Every shipped asset must be precached by the service worker, or it won't work offline.
const swSource = read('sw.js').toString();
const missing = files.filter((f) => /^(icons|assets)\//.test(f) && !f.endsWith('.txt') && !swSource.includes(`'${f}'`));
if (missing.length) throw new Error(`build: add these to ASSETS in sw.js: ${missing.join(', ')}`);
for (const f of files.sort()) all.update(f).update(read(f));
all.update(read('sw.js'));
const contentHash = all.digest('hex').slice(0, 8);
const label = process.env.BUILD_NUMBER ? `${process.env.BUILD_NUMBER} (${contentHash.slice(0, 6)})` : contentHash.slice(0, 6);

// 3. Rewrite references
function rewrite(file, edits) {
  const p = join(out, file);
  let s = readFileSync(p, 'utf8');
  for (const [from, to] of edits) {
    if (!s.includes(from)) throw new Error(`build: expected to find ${JSON.stringify(from)} in ${file}`);
    s = s.split(from).join(to);
  }
  writeFileSync(p, s);
}

rewrite('index.html', [
  ['href="styles.css"', `href="${renamed['styles.css']}"`],
  ['src="app.js"', `src="${renamed['app.js']}"`],
  ['<meta name="app-version" content="dev">', `<meta name="app-version" content="${label}">`],
]);
rewrite('sw.js', [
  ["'styles.css'", `'${renamed['styles.css']}'`],
  ["'app.js'", `'${renamed['app.js']}'`],
  ["'scorecard-dev'", `'scorecard-${contentHash}'`],
]);

console.log(`Built ${out}`);
console.log(`  version  ${label}`);
for (const [from, to] of Object.entries(renamed)) console.log(`  ${from} -> ${to}`);
