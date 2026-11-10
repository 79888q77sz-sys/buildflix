// StreamVault - streaming UI + security testing lab
// LAB_MODE=true (default): the UI trusts the plan returned by /api/me, and /api/movies/:id/watch
//   only requires a login. This is the intentional client-side-trust weakness to test with Burp.
// LAB_MODE=false: /api/movies/:id/watch verifies the plan stored in the database (secure behaviour).
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const LAB_MODE = process.env.LAB_MODE !== 'false';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'streamvault.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','vip')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS traffic_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, ip_address TEXT, method TEXT, endpoint TEXT, payload TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// ---------- Catalog (original fictional titles; poster images are placeholders) ----------
const VIDEOS = ['BigBuckBunny', 'ElephantsDream', 'Sintel', 'TearsOfSteel']
  .map(n => `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/${n}.mp4`);
const RAW = [
  ['Neon Horizon', 'Sci-Fi', '2h 15m', 2024, 8.4, 'A courier in a flooded megacity uncovers a signal older than the city itself.', 1],
  ['The Last Lighthouse', 'Drama', '1h 48m', 2023, 7.9, 'A keeper and a stranded sailor share one stormy winter on the edge of the world.', 1],
  ['Midnight Heist', 'Thriller', '1h 55m', 2022, 7.6, 'Five specialists, one vault, and ninety minutes before sunrise.', 1],
  ['Paper Moons', 'Comedy', '1h 37m', 2023, 7.1, 'Two rival bakers are forced to share a kitchen for one chaotic festival week.', 1],
  ['Wild Frontier', 'Documentary', '1h 30m', 2021, 8.0, 'A year following wolves across the northern wilderness.', 1],
  ['Iron Meridian', 'Action', '2h 08m', 2024, 7.8, 'A rogue pilot races a collapsing space elevator.', 0],
  ['Echoes of Ash', 'Drama', '2h 22m', 2022, 8.6, 'Three generations confront the secret buried beneath the family farm.', 0],
  ['Crimson Protocol', 'Thriller', '1h 59m', 2024, 8.1, 'An analyst realises the algorithm she built is selecting its own targets.', 0],
  ['Starfall Academy', 'Sci-Fi', '2h 05m', 2023, 7.4, 'Gifted students train to defend a station on the rim of known space.', 0],
  ['The Velvet Hour', 'Romance', '1h 44m', 2021, 7.2, 'A jazz pianist and a night-shift translator keep missing each other in Lisbon.', 0],
  ['Ghost Signal', 'Horror', '1h 41m', 2023, 7.0, 'A radio host starts receiving calls from a town that no longer exists.', 0],
  ['Desert Kings', 'Action', '2h 12m', 2022, 7.7, 'Rival convoys cross the dunes carrying the last of the water.', 0],
  ['Silent Orchard', 'Horror', '1h 36m', 2024, 6.9, 'The harvest is perfect. The workers are not leaving the trees.', 0],
  ['Lunar Tides', 'Sci-Fi', '2h 31m', 2024, 8.7, 'A tide-engineer on the moon discovers the ocean below is shifting on purpose.', 0],
  ['Backstreet Symphony', 'Drama', '1h 52m', 2021, 7.5, 'A street busker is invited to join a failing conservatory orchestra.', 0],
  ['Tin Soldiers', 'War', '2h 18m', 2022, 8.2, 'A winter retreat tests a platoon that has run out of orders.', 0],
  ['Coastal Lines', 'Documentary', '1h 26m', 2023, 7.8, 'Fishing villages and the shorelines that are quietly moving.', 0],
  ['Laugh Track', 'Comedy', '1h 33m', 2024, 7.0, 'A washed-up sitcom cast reunites for a reboot nobody asked for.', 0],
  ['Orbit 9', 'Sci-Fi', '1h 58m', 2023, 7.3, 'Nine strangers wake on a ship with no memory of boarding.', 0],
  ['The Gilded Cage', 'Thriller', '2h 02m', 2022, 7.9, 'A luxury hotel, a missing guest, and a staff that all tell the same story.', 0],
  ['Rainmaker', 'Drama', '2h 09m', 2021, 8.0, 'A drought-struck town hires a man who claims he can summon storms.', 0],
  ['Afterglow', 'Romance', '1h 47m', 2024, 7.6, 'Two astronomers fall for each other during a once-in-a-century eclipse.', 0],
  ['Black Ice', 'Action', '1h 53m', 2023, 7.2, 'A snowplough driver is the only witness to a highway ambush.', 0],
  ['Moonlit Tales', 'Fantasy', '2h 11m', 2022, 8.3, 'A cartographer maps a forest that rearranges itself every night.', 0],
  ['Dragon Ridge', 'Fantasy', '2h 24m', 2024, 8.5, 'A reluctant shepherd inherits a mountain and the thing that sleeps in it.', 0],
  ['Quiet Harbor', 'Drama', '1h 40m', 2021, 7.4, 'A widow reopens her late husband’s boat yard to the suspicion of the town.', 0],
];
const MOVIES = RAW.map(([title, genre, duration, year, rating, description, free], i) => ({
  id: i + 1, title, genre, duration, year, rating, description, vip: !free, featured: i === 0 || i === 13,
  poster: `https://picsum.photos/seed/sv-poster-${i + 1}/400/600`,
  backdrop: `https://picsum.photos/seed/sv-back-${i + 1}/1600/800`,
}));
const byId = new Map(MOVIES.map(m => [m.id, m]));

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
if (PROD) app.set('trust proxy', 1); // Railway / reverse proxy
app.use(express.json({ limit: '20kb' }));
app.use(session({
  name: 'sv.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 6 * 3600 * 1000 },
}));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; media-src https:; style-src 'self'; script-src 'self'; base-uri 'self'; form-action 'self'",
  });
  next();
});

// Traffic log (DB only, no UI panel). Passwords are redacted.
const logStmt = db.prepare('INSERT INTO traffic_logs(user_id,ip_address,method,endpoint,payload) VALUES(?,?,?,?,?)');
app.use('/api', (req, res, next) => {
  const body = { ...(req.body || {}) };
  if ('password' in body) body.password = '[REDACTED]';
  res.on('finish', () => {
    try {
      logStmt.run(req.session?.userId ?? null, req.ip, req.method, req.originalUrl, JSON.stringify(body).slice(0, 2000));
    } catch (e) { console.error('log error:', e.message); }
  });
  next();
});

const requireAuth = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ error: 'Please sign in' });

// Basic login throttle: 10 failures / 15 min per ip+email
const fails = new Map();
const throttled = key => { const f = fails.get(key); return f && f.n >= 10 && Date.now() - f.t < 15 * 60e3; };
const noteFail = key => { const f = fails.get(key); fails.set(key, { n: (f && Date.now() - f.t < 15 * 60e3 ? f.n : 0) + 1, t: Date.now() }); };

const publicUser = u => ({
  id: u.id, email: u.email, name: u.name, plan: u.plan, is_vip: u.plan === 'vip', created_at: u.created_at,
});

// ---------- Auth ----------
app.post('/api/register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)
    return res.status(400).json({ error: 'Please enter a valid email address' });
  if (password.length < 8 || password.length > 100)
    return res.status(400).json({ error: 'Password must be 8-100 characters' });
  const local = email.split('@')[0].replace(/[^a-z0-9]+/gi, ' ').trim() || 'Member';
  const name = local.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40);
  try {
    const user = db.transaction(() => {
      const info = db.prepare('INSERT INTO users(email,name,password_hash,plan) VALUES(?,?,?,?)')
        .run(email, name, bcrypt.hashSync(password, 10), 'free'); // plan is never taken from the request
      db.prepare('INSERT INTO subscriptions(user_id,plan) VALUES(?,?)').run(info.lastInsertRowid, 'free');
      return db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    })();
    req.session.regenerate(() => { req.session.userId = user.id; res.status(201).json({ user: publicUser(user) }); });
  } catch { res.status(409).json({ error: 'An account with this email already exists' }); }
});

app.post('/api/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = req.ip + '|' + email;
  if (throttled(key)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    noteFail(key); return res.status(401).json({ error: 'Incorrect email or password' });
  }
  fails.delete(key);
  req.session.regenerate(() => { req.session.userId = user.id; res.json({ user: publicUser(user) }); });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.clearCookie('sv.sid').json({ ok: true })));

// The frontend reads plan / is_vip from this response to decide what to unlock.
app.get('/api/me', (req, res) => {
  const u = req.session.userId && db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  res.json({ user: u ? publicUser(u) : null });
});

app.patch('/api/profile', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 40) return res.status(400).json({ error: 'Name must be 1-40 characters' });
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.session.userId);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId)) });
});

// Demo build: no payment provider is connected.
app.post('/api/subscribe', requireAuth, (req, res) =>
  res.status(501).json({ error: 'Subscriptions are not available in this demo.' }));

// ---------- Catalog ----------
app.get('/api/movies', requireAuth, (req, res) => res.json({ movies: MOVIES }));

app.get('/api/movies/:id/watch', requireAuth, (req, res) => {
  const m = byId.get(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Movie not found' });
  if (LAB_MODE === false && m.vip) {
    const u = db.prepare('SELECT plan FROM users WHERE id=?').get(req.session.userId);
    if (!u || u.plan !== 'vip') return res.status(403).json({ error: 'This is a VIP exclusive movie. Upgrade to VIP to watch.' });
  }
  res.json({ id: m.id, title: m.title, src: VIDEOS[m.id % VIDEOS.length] });
});

app.all('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Static + SPA fallback ----------
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0 }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`StreamVault on port ${PORT} (LAB_MODE=${LAB_MODE})`));
