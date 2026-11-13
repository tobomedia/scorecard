# Scorecard

Mobile web app for keeping score while watching a match. Ships with Rugby Union and Football presets, and you can build your own scoring system. Works offline and can be installed to your home screen.

See [docs/MVP-SPEC.md](docs/MVP-SPEC.md) for the product definition.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy (GitHub Pages)

Every push to `main` runs `.github/workflows/deploy.yml`, which builds and publishes the site.
Repo **Settings → Pages → Source** must be set to **GitHub Actions**.

The build (`scripts/build.mjs`):
- renames `app.js` and `styles.css` to content-hashed names (e.g. `app.3f9a1c2b.js`)
- rewrites `index.html` and `sw.js` to use them
- stamps a version into the service worker cache name and the home screen label

You never bump versions by hand. Installed phones check for updates each time the app opens or comes back to the foreground, then show a "tap to update" bar.

To try a production build locally:

```bash
node scripts/build.mjs && cd _site && python3 -m http.server 8000
```

## Files

- `index.html`, `styles.css`, `app.js`: the app (plain JS, no build step)
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and install
- `scripts/build.mjs`, `.github/workflows/deploy.yml`: deploy build
- All data lives in the phone's `localStorage`
