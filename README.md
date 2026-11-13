# Scorecard

Mobile web app for keeping score while watching a match. Ships with Rugby Union and Football presets, and you can build your own scoring system. Works offline and can be installed to your home screen.

See [docs/MVP-SPEC.md](docs/MVP-SPEC.md) for the product definition.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy (GitHub Pages)

Repo **Settings → Pages → Build and deployment → Deploy from a branch**, then pick the branch and the `/ (root)` folder.

## Updating

When you change any app file, bump `VERSION` in `sw.js` so installed phones fetch the new version.

## Files

- `index.html`, `styles.css`, `app.js`: the app (plain JS, no build step)
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and install
- All data lives in the phone's `localStorage`
