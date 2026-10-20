// Daily: look up current US list prices with Claude + web search, apply the safety rules in
// decide.mjs, and write prices.json / pending.json. The workflow commits whatever changed.
//   env: ANTHROPIC_API_KEY (repo secret), MODEL (optional), ONLY=netflix,spotify (optional)
import fs from 'node:fs';
import { decide, keyOf, servicesForToday, parseReply } from './decide.mjs';

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || 'claude-haiku-5-5';
// No key yet: skip quietly (a failing daily run would email the owner every day)
if (!KEY) {
  const msg = 'Skipped: add the ANTHROPIC_API_KEY repo secret (Settings → Secrets and variables → Actions) to start daily price checks.';
  console.log(msg);
  fs.writeFileSync('last-run.md', msg + '\n');   // the workflow commits this file every run
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg + '\n');
  process.exit(0);
}

const prices = JSON.parse(fs.readFileSync('prices.json', 'utf8'));
const pending = fs.existsSync('pending.json') ? JSON.parse(fs.readFileSync('pending.json', 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);
const names = JSON.parse(fs.readFileSync('services.json', 'utf8'));   // id → { name, domain }
const ids = process.env.ONLY ? process.env.ONLY.split(',') : servicesForToday(Object.keys(prices.services));

async function lookup(id) {
  const svc = names[id] || { name: id };
  const plans = prices.services[id];
  const prompt = `What are the current United States prices for ${svc.name}${svc.domain ? ` (${svc.domain})` : ''}?
Search the web and use the official ${svc.name} website or help center first; only use news if it reports a price change that is already in effect.
For EACH of these plans, give today's US price before tax, in USD:
${plans.map(p => `- "${p.plan}" billed ${p.billing} (we currently list $${p.cost})`).join('\n')}
Reply with only JSON: {"plans":[{"plan":"<exact name from the list>","billing":"monthly|yearly|weekly|quarterly","cost":<number or null if you could not confirm it>,"source":"<url>"}]}
Use null rather than guessing. Do not add plans that are not in the list.`;
  let messages = [{ role: 'user', content: prompt }];
  for (let turn = 0; turn < 4; turn++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }] }),
    });
    if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    if (j.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: j.content }]; continue; }
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return parseReply(text);
  }
  return null;
}

const log = [];
let changed = 0;
for (const id of ids) {
  if (!prices.services[id]) continue;
  let reply = null;
  try { reply = await lookup(id); } catch (e) { log.push(`- ${id}: lookup failed — ${e.message}`); continue; }
  if (!reply) { log.push(`- ${id}: no usable answer`); continue; }
  for (const cur of prices.services[id]) {
    const hit = reply.plans.find(p => p.plan === cur.plan && p.billing === cur.billing);
    const k = keyOf(id, cur.plan, cur.billing);
    const d = decide(cur, hit ? hit.cost : null, pending[k], today);
    if (d.pending) pending[k] = d.pending; else delete pending[k];
    if (d.action === 'apply') {
      log.push(`- **${id} ${cur.plan} (${cur.billing}): $${cur.cost} → $${d.cost}** (confirmed twice)${hit?.source ? ' — ' + hit.source : ''}`);
      cur.was = cur.cost; cur.cost = d.cost; cur.since = today; changed++;
    } else if (d.action === 'pending' && d.pending.firstSeen === today) {
      log.push(`- ${id} ${cur.plan}: saw $${d.pending.cost} (was $${cur.cost}) — goes live if tomorrow agrees`);
    } else if (d.action === 'skip' && d.reason !== 'no price found') {
      log.push(`- ${id} ${cur.plan}: skipped — ${d.reason}`);
    }
  }
}
if (changed) prices.updated = today;
fs.writeFileSync('prices.json', JSON.stringify(prices, null, 1) + '\n');
fs.writeFileSync('pending.json', JSON.stringify(pending, null, 1) + '\n');
const summary = `## Price check ${today}\nChecked ${ids.length} services with ${MODEL}. ${changed} price change${changed === 1 ? '' : 's'} went live.\n\n${log.join('\n') || 'Nothing changed.'}\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
fs.writeFileSync('last-run.md', summary);
