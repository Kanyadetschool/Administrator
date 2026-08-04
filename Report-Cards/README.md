# Kanyadet School App — Photo Upload Backend

Moves photo uploads off GitHub Pages (which is static-only and can't run this)
onto a real Node server that writes `./student_images/{Grade}/{Name}.jpg` to disk,
exactly matching the path convention `Results.html` already expects.

## Folder layout

```
your-project-root/
├── server.js
├── package.json
├── .env                    (optional — copy from .env.example)
├── Results.html            (and all your other site .html files)
├── student_images_seed/    (commit your EXISTING photos here, in Git)
└── student_images/         (live folder — gitignored, server writes new uploads here)
```

Why two folders? Render-style hosts wipe the filesystem back to your Git
checkout on every deploy unless you attach a persistent Disk — and the first
time a fresh disk mounts over `student_images/`, it's empty, hiding any photos
you'd committed there. So: existing photos go in `student_images_seed/` (tracked
in Git), and `server.js` copies them into the live `student_images/` folder
automatically the very first time it boots against an empty disk. After that,
new uploads just accumulate on the persistent disk like normal.

If you're moving to a plain VPS instead, this is a no-op — a VPS's disk is
already persistent, so just put your existing photos straight into
`student_images/` and skip the seed folder entirely.

## Option A — Render (easiest, no server maintenance)

1. Push this repo to GitHub (you've already got `kanyadetschool/results`).
2. On Render: **New → Web Service** → connect that repo.
3. Build command: `npm install`
   Start command: `node server.js`
4. **Add a persistent Disk** (Settings → Disks): mount path `/opt/render/project/src/student_images`
   (Render shows you the exact project path — use that, with `/student_images` appended), size 1GB is plenty to start.
5. Add the env var `UPLOAD_API_KEY` (Settings → Environment) — pick any random string. This stops strangers from overwriting your students' photos, since the upload endpoint will be public on the internet.
6. Deploy. First boot seeds `student_images/` from `student_images_seed/` automatically.
7. Your site is now at `https://your-service-name.onrender.com/Results.html` (or wherever in the repo it lives) instead of the `github.io` URL. Update any bookmarks/links accordingly, and point a custom domain at it if you have one (Render → Settings → Custom Domain).

Free-tier Render services spin down after inactivity and take ~30s to wake on
the next request — fine for occasional admin use, less fine if parents check the
portal often. The cheapest paid tier removes that delay and is needed for the
persistent Disk anyway.

## Option B — VPS (DigitalOcean/Linode/etc. droplet)

```bash
# on the server, as a non-root user with the repo cloned
cd your-project-root
npm install
cp .env.example .env        # set UPLOAD_API_KEY in here
npm install -g pm2          # keeps the server running, restarts on crash/reboot
pm2 start server.js --name kanyadet-school
pm2 save
pm2 startup                 # follow the printed instructions so it survives reboots
```

Put nginx in front of it for HTTPS (certbot for a free cert) and proxy to
`http://localhost:3000`. A VPS's filesystem is persistent by default, so no
seed-folder dance needed — just put your existing photos straight into
`student_images/`.

## After deploying, in Results.html

Nothing to change — `PHOTO_UPLOAD_ENDPOINT` is already set to the relative
path `'./api/upload-photo'`, and since `server.js` serves `Results.html`
itself (same origin), it just works.

If you set `UPLOAD_API_KEY` in step 5/above, also set the matching value in
`Results.html`:

```js
const PHOTO_UPLOAD_API_KEY = 'the-same-random-string-you-used';
```

## Endpoints

- `POST /api/upload-photo` — multipart fields: `photo` (file), `name`, `grade`. Saves to `./student_images/{Grade}/{Name}.jpg`.
- `DELETE /api/photo?name=...&grade=...` — removes a student's photo.

Both require an `x-api-key` header matching `UPLOAD_API_KEY` if you set one;
otherwise they're open (fine for local testing, not for a public host).
