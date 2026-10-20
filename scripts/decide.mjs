// The safety rules for a price the lookup found. Pure, so it's tested offline (scripts/test.mjs).
//
//   • only plans already in prices.json (matched by plan name + billing) — never invents plans
//   • a change of more than ±40% is a misread, skipped
//   • a new price goes live only after two runs on different days found the same number
//   • finding the current price again clears any half-confirmed change
export const MAX_CHANGE = 0.4;

export const keyOf = (serviceId, plan, billing) => `${serviceId}|${plan}|${billing}`;

/**
 * @param {object} cur   current plan entry { plan, billing, cost }
 * @param {number} found price the lookup found (null when it found nothing)
 * @param {object} pend  pending entry for this plan, if any: { cost, firstSeen }
 * @param {string} today YYYY-MM-DD
 * @returns {{ action: 'same'|'skip'|'pending'|'apply', reason?: string, pending?: object|null, cost?: number }}
 */
export function decide(cur, found, pend, today) {
  if (typeof found !== 'number' || !isFinite(found) || found <= 0) return { action: 'skip', reason: 'no price found', pending: pend || null };
  found = Math.round(found * 100) / 100;
  if (Math.abs(found - cur.cost) < 0.01) return { action: 'same', pending: null };
  const change = Math.abs(found - cur.cost) / cur.cost;
  if (change > MAX_CHANGE) return { action: 'skip', reason: `${cur.cost} → ${found} is a ${Math.round(change * 100)}% jump`, pending: null };
  if (pend && Math.abs(pend.cost - found) < 0.01 && pend.firstSeen < today) return { action: 'apply', cost: found, pending: null };
  if (pend && Math.abs(pend.cost - found) < 0.01) return { action: 'pending', pending: pend };          // same day, wait for tomorrow
  return { action: 'pending', pending: { cost: found, firstSeen: today } };
}

// Which services this run checks: the big ones every day, the rest spread over the week
export const DAILY = ['netflix', 'disneyplus', 'hulu', 'hbomax', 'primevideo', 'youtube', 'youtubetv', 'spotify', 'applemusic', 'appleone', 'icloud', 'googleone', 'chatgpt', 'claude', 'microsoft365', 'xbox', 'psplus', 'paramount', 'peacock'];
export function servicesForToday(allIds, date = new Date()) {
  const day = Math.floor(date.getTime() / 86400000);
  return allIds.filter((id, i) => DAILY.includes(id) || i % 7 === day % 7);
}

// The model's reply → { plans: [{ plan, billing, cost }] }; tolerant of prose around the JSON
export function parseReply(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return Array.isArray(j.plans) ? j : null;
  } catch { return null; }
}
