# PactPin prices

The public list prices the PactPin app checks to warn people when a subscription they track gets more expensive.
Only public list prices are here (service, plan, billing, US price). No user data.

- `prices.json`: what the app fetches (`raw.githubusercontent.com/SheetritBen/pactpin-prices/main/prices.json`), at most every 12 hours per phone.
- `services.json`: service names and domains the updater searches for.
- `pending.json`: price changes seen once and waiting for a second sighting.
- `last-run.md`: what the latest daily check did.
- `trip-rules.json`: passport entry rules for US passport holders (Trip check), from US State Department country pages. Edit by hand when a rule changes; the app picks it up within a day.

## How it stays current (automatic)
`.github/workflows/update-prices.yml` runs daily. Claude (with web search) looks up current US prices: the big services every day, and everything else once a week. `scripts/decide.mjs` applies the safety rules:
- only plans already listed are updated
- changes over ±40% are skipped as misreads
- a new price goes live only after two runs on different days agree

Changes are committed automatically.

Needs one repo secret: `ANTHROPIC_API_KEY`. The `MODEL` env var is optional (default `claude-haiku-5-5`).
Run it by hand: Actions → Update prices → Run workflow (optionally `only: netflix,spotify`).

New services/plans come from the app's catalog: `node tools/export-prices.js ../pactpin-prices` in the keeper repo (keeps current prices).
