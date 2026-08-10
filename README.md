# freashwater-future

**Freshwater Future Tracker** — the companion web app for **BloomGuard**, an autonomous solar buoy that
detects harmful algal blooms before they are visible, releases an algicidal-bacteria cartridge,
and skims the dead algae for biogas recovery.

Built for the Oxford Climate Challenge (Freshwater Futures). The app runs in a simulated iPhone
frame on desktop and full-bleed on a real phone.

## Run it

No build step, no dependencies. Serve the folder over HTTP:

```bash
python3 -m http.server 8099
```

Then open <http://localhost:8099>. Any email + password logs you in.

> Opening `index.html` directly via `file://` will not work — browsers block the module scripts.

**If an edit doesn't seem to take effect,** it's the browser cache. The asset URLs in `index.html`
carry a `?v=` query — bump it after editing anything in `assets/`, and hard-reload the page
(`Cmd-Shift-R`) so the HTML itself is re-fetched too.

## Screens

| Screen | What it does |
| --- | --- |
| **Login** | Matches the original mockup: logo, credentials, white sheet with Login / Create account. |
| **Home** | Live buoy hero, bloom-risk summary card, cartridge status, fleet teaser, holding-tank fill. |
| **Live Sensor Dashboard** | Real-time pH / DO / AVOC / temp / chlorophyll-a / phycocyanin / turbidity / nitrate / phosphate, a bloom-risk gauge, and a breakdown of which channels are driving the score. |
| **Analytics** | Daily / Weekly / Monthly / Yearly summary, algae-collected progress, dual trend chart, resource-recovery totals. |
| **Fleet View** | All six buoys across six operators, ranked by bloom risk, with a schematic basin map. |
| **Alerts** | Alert feed plus the rules that generate it — risk threshold, DO floor, auto-deploy, quiet hours. |
| **Cartridge Log** | Deployment history with state (loaded → deployed → spent → retrieved), dose, remaining capacity and measured knockdown. |
| **Harvest & Biogas** | Skimmer → holding tank → shore digester → energy return chain. |
| **Profile** | Operator identity, fleet totals, shortcuts. |

## The four requested features

- **Live Sensor Dashboard** — nine channels update on a tick (1.6 s, or 0.7 s in demo mode), each
  with a sparkline, a two-hour delta and an out-of-band flag. The bloom-risk score is recomputed
  from the readings every tick.
- **Alerts** — when the risk score crosses your threshold, the app fires an iOS-style banner inside
  the phone *and* a real browser notification (if you grant permission). Alerts fire on the rising
  edge only, with a per-rule cooldown, so a reading that sits above the line does not spam you.
- **Cartridge Log** — full deployment history, remaining capacity per cartridge, retrieval status,
  and a "Mark retrieved" action on spent housings.
- **Fleet View** — every buoy with its live risk score, battery, cartridge count and operator,
  sorted worst-first. Tap any buoy to open its sensor dashboard.

## Demo script

1. Log in.
2. Go to **Live Sensors**.
3. Press <kbd>D</kbd> to switch to fast demo speed.
4. Tap **Simulate bloom** — nutrient and biomass channels start climbing.
5. Around risk 65 the threshold alert fires, a push banner appears, and (because auto-deploy is on)
   a cartridge is released automatically and logged.
6. Watch the score fall back as the knockdown takes effect, then open **Cartridge Log** to see the
   new entry.

Keyboard: <kbd>←</kbd> / <kbd>→</kbd> move between tabs, <kbd>D</kbd> toggles demo speed,
<kbd>Esc</kbd> closes the side menu.

## How the bloom-risk score works

`assets/data.js` holds the model. Each channel is normalised to 0–1 in the direction that raises
bloom pressure (dissolved oxygen is inverted — low DO is bad), then combined with the weights in
`BB.RISK_WEIGHTS`:

| Channel | Weight | Why |
| --- | --- | --- |
| Phycocyanin | 0.22 | Direct cyanobacteria pigment signal |
| Chlorophyll-a | 0.20 | Total algal biomass |
| AVOC index | 0.18 | Volatiles shift **before** surface biomass is visible |
| Phosphate | 0.12 | Limiting nutrient in most freshwater systems |
| Nitrate | 0.09 | Nutrient load |
| Temperature | 0.09 | Growth-rate driver |
| Dissolved O₂ | 0.06 | Depletion from decay |
| pH | 0.04 | Rises during heavy photosynthesis |

The weighted average is passed through a light sigmoid so mid-range readings separate more cleanly,
and reported 0–100.

## Data honesty

Everything in the app is **simulated** — there is no buoy on the other end. The sensor values are
seeded random walks bounded to realistic freshwater ranges, and the fleet, cartridge history and
period totals are illustrative. The device design, sensor suite, algicidal-cartridge approach and
biogas recovery chain all come from the project brainstorm; the numbers attached to them do not.
If you present this, say it is a working interface prototype over a simulated feed.

## Files

```
index.html          markup, iPhone frame, SVG icon sprite
assets/styles.css   all styling
assets/data.js      sensor specs, fleet, cartridges, risk model, projection
assets/geo.js       generated coastlines + political boundaries
assets/app.js       screens, router, charts, simulation loop, notifications
```

Charts are hand-rolled SVG — no chart library, no CDN, works offline.

## Map data

`assets/geo.js` is generated from [Natural Earth](https://www.naturalearthdata.com/)
1:110m `land` and `admin_0_boundary_lines_land`, which are **public domain** — no
attribution required, though it is good practice to credit them. The rings were
simplified with Douglas-Peucker at 0.45° and rounded to two decimals, which gets
68 coastlines and 333 border segments into ~44 KB. It is committed as generated
output so the app still has no build step and no network dependency.

To regenerate at a different level of detail, re-download those two GeoJSON files
and re-run the simplification with a smaller tolerance — 0.45° is tuned for a
phone-sized world map, not for zooming into a single lake.
