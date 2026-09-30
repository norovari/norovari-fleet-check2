// /api/submit.js — lead capture for the Fleet Risk Check.
//
// This is a SEPARATE Vercel project from the investor terminal, so it has
// its own environment variables. Set SHEET_WEBHOOK_URL here to whichever
// Google Sheet you want these leads to land in — it can be the same sheet
// the investor terminal uses (tagged distinctly below) or a dedicated one;
// your call, just set the env var on this project accordingly.
//
// No technical/IP content ever passes through this endpoint — only track
// choice, answers (all plain-language options, no architecture detail),
// contact info, and referral codes.

const hits = new Map(); // ip -> [timestamps]
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests — please slow down and try again in a minute.' });
  }

  const { track, name, company, contact, answers, ownRefCode, referredBy, timestamp } = req.body || {};

  if (!name || !contact || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const safeTrack = track === 'finance' ? 'finance' : 'fleet';

  if (process.env.SHEET_WEBHOOK_URL) {
    fetch(process.env.SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 'Fleet Check Lead',
        org: (company || '').slice(0, 200),
        email: (contact || '').slice(0, 200),
        chequeRange: '', // not applicable to this lead type — kept for sheet-column compatibility if reusing the investor sheet
        source: ip,
        timestamp: timestamp || new Date().toISOString(),
        answers: JSON.stringify({
          track: safeTrack,
          name: (name || '').slice(0, 200),
          responses: answers,
          ownRefCode: ownRefCode || '',
          referredBy: referredBy || '',
        }).slice(0, 3000),
      }),
    }).catch(e => console.error('Fleet-check lead log failed:', e));
  }

  return res.status(200).json({ success: true });
};
