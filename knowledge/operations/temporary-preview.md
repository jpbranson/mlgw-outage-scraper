---
type: Guide
title: "Temporary phone preview (historical procedure)"
description: "Password-protected Cloudflare Quick Tunnel preview procedure, security properties, troubleshooting and the dated September 16–18 sessions."
tags: [operations, preview, security, historical]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T04:17:59Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: preview-verification
    resource: "../../reports/preview-verification.json"
    title: "Preview verification (local, ignored by Git)"
    last_modified: 2026-09-21T13:20:16Z
  - id: preview
    resource: "../../scripts/preview.mjs"
    title: "Preview supervisor"
    last_modified: 2026-09-16T18:39:44Z
  - id: gateway-tests
    resource: "../../test/preview-gateway.test.mjs"
    title: "Gateway authentication tests"
    last_modified: 2026-09-21T13:27:08Z
---
# Temporary phone preview

**Historical preview procedure:** current public access is https://64.225.60.118 and does not use the old preview password. The September 18 Quick Tunnel ran from **7:06:19 AM CDT / 12:06:19 UTC** with an automatic expiry at **3:06:19 PM CDT / 20:06:19 UTC**. Its checks and the procedures below are retained for a separately requested future local preview; old session links and passwords are not current access instructions.

The user authorized temporary password-protected HTTPS access through Cloudflare Quick Tunnels on September 16 and explicitly requested new deployments on September 17 and September 18. `scripts/preview.mjs` runs a separate gateway on loopback port 4174 and a standalone, signed `cloudflared` process; it installs no Windows service and changes no router/firewall settings. The gateway forwards only authenticated, allowlisted read routes to the local dashboard on port 4173. Its metrics listener is loopback-only on port 4175 and is not routed publicly. These three ports are fixed in the preview supervisor; a dashboard launched with another `DASHBOARD_PORT` is not compatible with this preview configuration.

The first run expired automatically at 9:40 PM CDT on September 16. The replacement requested September 17 started at **5:57:53 AM CDT**, with a scheduled expiry of **1:57:53 PM CDT that day** (`2026-09-17T18:57:53.318Z`), and was closed early at **7:29:59 AM CDT**. These are dated session records. Use `preview:status` for the current session state. Any future active preview requires the PC, dashboard, gateway and tunnel processes to keep running; it is not a production hosting service or uptime guarantee. During a preview, Cloudflare carries web traffic while capture and archive storage remain on the PC.

```powershell
npm run preview:status
node scripts/verify-preview.mjs
npm run preview:stop
```

`stop` signals the preview supervisor to stop its own tunnel child and gateway. It leaves the collector, pilot and local dashboard running. For an explicitly requested new session, first build/start the dashboard at port 4173 and ensure the verified executable exists at `data/tools/cloudflared.exe`, then run `npm run preview:start` in a separate terminal and leave it running. It creates a fresh random password, new temporary link and eight-hour expiry; do not start a replacement automatically after the user’s review window ends. The executable and saved weather/captures are local prerequisites, not included in a fresh checkout. No Cloudflare account login or permanent deployment is part of this script.

The preview uses a generated 144-bit password, in-memory sessions, Secure/HttpOnly cookies, HTTPS enforcement, same-origin login, bounded login attempts/bodies and no-store responses. Root requests without a session see only the password form; assets, API reads and exports require authentication. Archives, admin paths and mutation methods are denied. The password is supplied to the owner in chat, not checked into source or written to application logs. Its local credential file and runtime state are under ignored `data/remote-preview/`; keep those files private. The downloaded executable is under ignored `data/tools/`.

Cloudflared 2026.9.1 was downloaded from Cloudflare’s official GitHub release and verified against its published SHA-256 (`2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712`) and valid Cloudflare Authenticode signature. These identify the installed binary, not an automatically updated version. Password/authentication tests are in `test/preview-gateway.test.mjs`. `node scripts/verify-preview.mjs` checks the active external link without printing the password or cookies; its report is `reports/preview-verification.json`. It verifies login, anonymous denial, outage totals/geometry, blocked archive/admin/write routes, HTTPS, all prepared rainfall periods and PNGs, and legacy catalogs/charts/replay/CSV/exact polygons. The rainfall check requires the 24/48/72-hour sample assets. Browser sign-in, live data and legacy grid replay were verified September 18 without console warnings/errors. The initial matched-reference checkpoint passed 154 Node tests. The September 18 autonomous continuation passed 172; all four cases, all lags, cold geometry and matched-reference CSV/masks passed the preview verifier at that checkpoint. That session's output is in `reports/preview-20260918.stdout.log` and `reports/preview-20260918.stderr.log`; earlier runs used `reports/preview.stdout.log` and `reports/preview.stderr.log`.

If sign-in fails, use the URL from `preview:status` and the password from that same session. Copy the entire case-sensitive password, including any leading underscore. The gateway ignores surrounding whitespace and zero-width spaces introduced by copying; letter case and characters within the password still must match exactly. The password field disables mobile capitalization, autocorrection and spellcheck. An expired preview needs an explicitly requested new session; the previous URL/password cannot be reused. Successful script verification alone does not prove a particular device signed in: inspect the exact browser error if the issue persists.
