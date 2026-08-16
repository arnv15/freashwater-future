# freashwater-future

**Algae Guard** — the companion web app for the Algae Guard autonomous solar buoy, which
detects harmful algal blooms before they are visible and releases nanobubbles that lyse the
algae and reoxygenate the water. Nothing is skimmed and nothing is hauled ashore.

Built for the Oxford Climate Challenge. The app runs in a simulated iPhone
frame on desktop and full-bleed on a real phone.

## Run it

No build step, no dependencies. Serve the folder over HTTP:

```bash
python3 -m http.server 8099
```

Then open <http://localhost:8099>. There is no sign-in — it opens straight onto the fleet map.

> Opening `index.html` directly via `file://` will not work — browsers block the module scripts.

**If an edit doesn't seem to take effect,** it's the browser cache. The asset URLs in `index.html`
carry a `?v=` query — bump it after editing anything in `assets/`, and hard-reload the page
(`Cmd-Shift-R`) so the HTML itself is re-fetched too.

## Screens

| Screen | What it does |
| --- | --- |
| **Home** | Full-screen zoomable world map of the fleet; tap any buoy for a detail sheet. |
| **Live Sensor Dashboard** | Real-time pH / DO / AVOC / temp / chlorophyll-a / phycocyanin / turbidity / nitrate / phosphate, a bloom-risk gauge, and a breakdown of which channels are driving the score. |
| **Analytics** | Daily / Weekly / Monthly / Yearly summary, algae-collected progress, dual trend chart, resource-recovery totals. |
| **Fleet Map** | Zoomable world map with every buoy at its true lat/lon; tap a marker for a detail sheet. |
| **Alerts** | Alert feed plus the rules that generate it — risk threshold, DO floor, auto-deploy, quiet hours. |
| **Release Log** | Nanobubble release history with state (scheduled → active → complete), duration, water treated, oxygen dispersed and measured knockdown. |
| **Oxygen & Breakdown** | Solar charge → bubble generation → suspension → collapse and lysis → reoxygenation → remineralisation in place. |
| **Profile** | Operator identity, fleet totals, shortcuts. |

## The four requested features

- **Live Sensor Dashboard** — nine channels update on a tick (1.6 s, or 0.7 s in demo mode), each
  with a sparkline, a two-hour delta and an out-of-band flag. The bloom-risk score is recomputed
  from the readings every tick.
- **Alerts** — when the risk score crosses your threshold, the app fires an iOS-style banner inside
  the phone *and* a real browser notification (if you grant permission). Alerts fire on the rising
  edge only, with a per-rule cooldown, so a reading that sits above the line does not spam you.
- **Release Log** — full nanobubble release history, water treated and oxygen dispersed per
  release, and a "Stop release" action on anything currently aerating.
- **Fleet Map** — every buoy at its true lat/lon with its live risk score, generator state and
  operator. Pinch or scroll to zoom, tap a marker for details.

## Demo script

1. Go to **Live Sensors**.
2. Press <kbd>D</kbd> to switch to fast demo speed.
3. Tap **Simulate bloom** — nutrient and biomass channels start climbing.
4. Around risk 65 the threshold alert fires, a push banner appears, and (because auto-release is on)
   a nanobubble release starts automatically and is logged.
5. Watch the score fall back as lysis takes effect and dissolved oxygen climbs, then open
   **Release Log** to see the new entry.

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
seeded random walks bounded to realistic freshwater ranges, and the fleet, release history and
period totals are illustrative. The device design, sensor suite and nanobubble
aeration approach all come from the project brainstorm; the numbers attached to them do not.
If you present this, say it is a working interface prototype over a simulated feed.

## Files

```
index.html          markup, iPhone frame, SVG icon sprite
assets/styles.css   all styling
assets/data.js      sensor specs, fleet, nanobubble releases, risk model, projection
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
