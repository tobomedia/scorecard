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
// ...and everything sw.js precaches must exist, or the service worker fails to install.
const listed = [...swSource.matchAll(/'((?:icons|assets)\/[^']+)'/g)].map((m) => m[1]);
const ghosts = listed.filter((f) => !files.includes(f));
if (ghosts.length) throw new Error(`build: sw.js lists files that don't exist: ${ghosts.join(', ')}`);
for (const f of files.sort()) all.update(f).update(read(f));
all.update(read('sw.js'));
const contentHash = all.digest('hex').slice(0, 8);
const label = process.env.BUILD_NUMBER ? `${process.env.BUILD_NUMBER} (${contentHash.slice(0, 6)})` : contentHash.slice(0, 6);

// Live score server address (set by the deploy workflow once Cloudflare is configured).
// Empty = live sharing hidden in the app.
const liveApi = (process.env.LIVE_API_URL || '').trim().replace(/\/$/, '');
if (liveApi && !/^https?:\/\/[\w.:-]+$/.test(liveApi)) throw new Error(`build: LIVE_API_URL looks wrong: ${liveApi}`);

// Help & FAQ must keep up with the app: every feature people use has to be explained.
// When you add or rename a feature, update HELP in app.js and add its button/label here.
const HELP_TERMS = [
  'New match', 'Start clock', 'Pause', 'Half time', 'Start 2nd half', 'End 1st half early', 'Full time',
  'Undo', 'Log', 'Add missed event', 'Edit match', 'Share result', 'Copy link', 'Save to my history',
  'Open a shared link', 'Go live', 'Copy live link', 'Back up', 'Restore', 'Time-up alerts', 'New sport',
  'follow-up', 'Rugby League', 'Rugby Sevens', 'Penalty try', 'Netball', 'Cricket', 'Wide', 'No-ball', 'Bye',
  'Start 2nd innings', 'Finish match', 'Golf courses', 'Quick round', 'Card', 'Edit round', 'full screen',
  'New version available', 'Low Power Mode',
];
{
  const src = read('app.js').toString();
  const help = src.slice(src.indexOf('const HELP = {'), src.indexOf('function viewHelp'));
  const missing = HELP_TERMS.filter((t) => !help.toLowerCase().includes(t.toLowerCase()));
  if (missing.length) throw new Error(`build: Help & FAQ (HELP in app.js) doesn't mention: ${missing.join(', ')}`);
}

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
  ['<meta name="live-api" content="">', `<meta name="live-api" content="${liveApi}">`],
]);
rewrite('sw.js', [
  ["'styles.css'", `'${renamed['styles.css']}'`],
  ["'app.js'", `'${renamed['app.js']}'`],
  ["'scorecard-dev'", `'scorecard-${contentHash}'`],
]);

console.log(`Built ${out}`);
console.log(`  version  ${label}`);
console.log(`  live api ${liveApi || '(not set: live sharing hidden)'}`);
for (const [from, to] of Object.entries(renamed)) console.log(`  ${from} -> ${to}`);
