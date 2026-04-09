# Sprint 15 — NAS Deployment Instructions

These are the exact changes required to `server.js` and `docker-compose.yml`
to activate the fit-tracker app on the existing webapp platform.
No Dockerfile changes required (no new npm dependencies).

---

## Step 1 — Copy router to NAS

Copy `fit-tracker-router.js` to:
  /volume1/Share/webapp/apps/fit-tracker/router.js

Create the app directory if it doesn't exist:
  mkdir -p /volume1/Share/webapp/apps/fit-tracker/sync

---

## Step 2 — Copy PWA build output to NAS

After running `npm run build` in the client directory, copy the `dist/`
contents to the NAS:
  /volume1/Share/webapp/apps/fit-tracker/
    index.html
    assets/
    icons/
    exercise-library.json
    sw.js
    (all other build artifacts)

The Vite build outputs to `dist/` — copy the contents (not the folder itself).

---

## Step 3 — Edit server.js

Add the following two lines in the marked sections:

### Static mount (after the meditations mount):

```js
// Adaptive Fitness Coach PWA
app.use('/fit-tracker', express.static(path.join(APPS_DIR, 'fit-tracker')));
```

### API router mount (after the API routers comment):

```js
app.use('/api/fit-tracker', require('./apps/fit-tracker/router')(config));
```

### Updated startup log (add to the console.log block):

```js
console.log(`  /fit-tracker/ → apps/fit-tracker/`);
console.log(`  /api/fit-tracker/* → apps/fit-tracker/router.js`);
```

Full diff (context lines shown with leading space):

```diff
 // Meditations PWA
 app.use('/meditations', express.static(path.join(APPS_DIR, 'meditations')));

+// Adaptive Fitness Coach PWA
+app.use('/fit-tracker', express.static(path.join(APPS_DIR, 'fit-tracker')));

 // ── Future app static mounts
-// app.use('/fit-tracker',  express.static(path.join(APPS_DIR, 'fit-tracker')));
```

```diff
 // Athanor — all /api/* routes handled in apps/athanor/router.js
 app.use('/api', require('./apps/athanor/router')(config));

-// Future app API mounts:
-// app.use('/api/fit-tracker',  require('./apps/fit-tracker/router')(config));
+app.use('/api/fit-tracker', require('./apps/fit-tracker/router')(config));
```

---

## Step 4 — Edit docker-compose.yml

Add the fit-tracker volume mount under the `volumes:` section:

```diff
       - /volume1/Share/webapp/apps/meditations:/app/apps/meditations
-      # - /volume1/Share/webapp/apps/fit-tracker:/app/apps/fit-tracker
+      - /volume1/Share/webapp/apps/fit-tracker:/app/apps/fit-tracker
```

---

## Step 5 — Edit config.json

Add the fit-tracker app section:

```json
{
  "token": "your-existing-token",
  "port": 3000,
  "host": "0.0.0.0",
  "anthropic_api_key": "sk-ant-...",
  "apps": {
    "fit-tracker": {
      "anthropic_api_key": "sk-ant-..."
    }
  }
}
```

If `apps.fit-tracker.anthropic_api_key` is omitted, the router falls back
to the platform-level `anthropic_api_key`. Either works; the app-scoped key
is recommended for cost tracking separation.

---

## Step 6 — Deploy

Because docker-compose.yml changed (new volume mount), a container recreate
is required — not just a restart.

Per WEBAPP_PLATFORM_REFERENCE.md §5 (Docker Operations):

  Operation: Recreate (volume mounts changed)
  Steps: Stop → Delete container → Redeploy (no image delete needed)

In DSM Container Manager:
  1. Stop the webapp container
  2. Delete the container (keep the image)
  3. Re-deploy from the updated docker-compose.yml

Because server.js is volume-mounted (:ro), the static mount and API router
changes take effect on the recreate without a full image rebuild.

---

## Step 7 — Verify

After deployment, check:

  GET https://hontechnologies.com/fit-tracker/api/fit-tracker/health
  → { ok: true, service: "fit-tracker", claude: true, syncDir: true }

  GET https://hontechnologies.com/fit-tracker/
  → Serves index.html (PWA shell)

  Install via Android Chrome: "Add to Home Screen"
  → start_url /fit-tracker/ — installs as standalone app

---

## Important: Test LLM features via external domain only

Per the known Comcast DPI issue documented in WEBAPP_PLATFORM_REFERENCE.md §6:
Claude API calls from the NAS container succeed only via the Cloudflare tunnel
(hontechnologies.com), not via LAN (192.168.x.x:3000).

Test the /claude/complete proxy using the external domain.
LAN access works for everything else (static assets, sync endpoints, health check).
