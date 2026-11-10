# StreamVault — streaming UI & security testing lab

## Run locally
```bash
npm install
npm start            # http://localhost:3000
```
Requires Node 18+. Register any account from the UI — new users get `plan: "free"`.

## The lab: subscription/role tampering
With the default `LAB_MODE=true`:
- `GET /api/me` returns `plan` and `is_vip` for the logged-in user, and the frontend uses that field, and only that field, to decide whether to unlock VIP titles, remove padlocks, and show "VIP Plan Active" on the dashboard.
- `GET /api/movies/:id/watch` only checks that you're logged in — it does not check `plan` — so once the UI believes you're VIP, playback also works.

**To exploit it:**
1. Proxy your browser through Burp, register/sign in as a free user.
2. Intercept the response to `GET /api/me`.
3. Change `"plan":"free"` to `"plan":"vip"` (and/or `"is_vip":false` to `true`), forward it.
4. The UI instantly unlocks every VIP card, drops the padlocks, and the Dashboard shows "VIP Plan Active" — all from that one tampered response, with no further requests needed.

**To see the fix:** run `LAB_MODE=false npm start`. The client can still be tricked into showing an unlocked UI (that part is cosmetic), but `GET /api/movies/:id/watch` re-checks the plan stored in the database and returns 403 with "This is a VIP exclusive movie. Upgrade to VIP to watch." for any VIP title, so tampering the response no longer grants real access. (Nothing in this demo lets a user actually change their stored plan — there's no payment flow.)

## Deploying on Railway
1. Push this folder to a Git repo and create a new Railway project from it (`npm start` is the start command via `package.json`).
2. Add two variables in the Railway dashboard:
   - `SESSION_SECRET` — any long random string.
   - `NODE_ENV=production`
   - Optionally `LAB_MODE=false` to disable the response-trust bug for a demo deployment.
3. Railway sets `PORT` automatically; the server already binds to `process.env.PORT`.
4. The SQLite file is written to `./data/streamvault.db` (or `DB_PATH` if you set it). On Railway's ephemeral filesystem this resets on redeploy — add a Railway Volume mounted at `/data` and set `DB_PATH=/data/streamvault.db` if you want it to persist.
5. No build step is needed; static files are served from `/public` with a catch-all route to `index.html`, so there's no white-screen on refresh of any client route.

## What's real here
- bcrypt-hashed passwords, `httpOnly`/`sameSite` session cookie, session regeneration on login/register, a basic login-attempt throttle, and a `Content-Security-Policy`.
- Every catalog and session field is read from the database with parameterized queries.
- Traffic is logged to the `traffic_logs` table (passwords redacted) for your own inspection — there's no debug panel rendered in the UI.

## What's deliberately not production-grade
- `LAB_MODE=true` by default — the whole point is the client-trust bug above.
- No payment provider; `/api/subscribe` returns 501. Nothing upgrades a user's stored plan for real.
- Movie posters/backdrops are placeholder images from picsum.photos (random, not matched to titles), and playback uses a few public Google sample videos on a loop — swap both for your own assets in `server.js` before using this for anything real.
- Titles, plots, and cast are invented for this demo; none reference real films.
- In-memory login throttle and session store — fine for one instance, not for multi-instance production.
