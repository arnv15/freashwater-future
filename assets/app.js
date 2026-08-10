/* ============================================================
   Freshwater Future Tracker — app shell, screens, live simulation
   ============================================================ */
(function () {
'use strict';

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const app     = $('#app');
const screenEl= $('.device__screen');
const drawer  = $('#drawer');
const pushwrap= $('#pushwrap');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ic  = (id, cls) => `<svg class="${cls||''}" viewBox="0 0 24 24"><use href="#${id}"/></svg>`;

/* ============================================================
   STATE
   ============================================================ */
const state = {
  auth:false,
  user:{ name:'Field Ops', email:'ops@toledowater.gov', org:'Toledo Water Authority' },
  screen:'home',
  buoyId:'BG-014',
  range:'weekly',
  fast:false,
  hist:{},                 // buoyId -> { sensorKey: [values] }
  boost:{},                // buoyId -> forcing term for the sim
  rnd:{},                  // buoyId -> seeded RNG
  aboveRisk:{},            // buoyId -> was over the risk threshold last tick?
  lowDO:{},                // buoyId -> was under the DO floor last tick?
  cooldown:{},             // buoyId -> { risk, do } ticks until that rule may fire again
  alerts:[],
  cartridges:BB.CARTRIDGES.map(c => Object.assign({}, c)),
  thresholds:{ risk:65, autoDeploy:true, pushEnabled:true, quiet:false, doFloor:5.0 },
  tickCount:0,
  /* map window: centre in map units (deg) + zoom, 1 = full latitude */
  map:{ cx:80, cy:90, zoom:1, focusIdx:null, selected:null }
};

BB.FLEET.forEach(b => {
  state.hist[b.id]  = BB.seedHistory(b);
  state.rnd[b.id]   = BB.makeWalker(b.id.charCodeAt(4) * 104729 + 7);
  state.boost[b.id] = 0;
  state.cooldown[b.id] = { risk:0, do:0 };
});

const buoy      = id => BB.FLEET.find(b => b.id === (id || state.buoyId));
const readings  = id => BB.latest(state.hist[id || state.buoyId]);
const riskOf    = id => BB.riskScore(readings(id));

/* seed alert feed */
state.alerts = [
  { id:'a1', sev:'crit', icon:'ic-warn',  color:'#DE3B3B', title:'Bloom risk 74 — Maumee Bay',
    body:'Phycocyanin up 41% in 6 h with AVOC index at 26.5 ppb. Model puts a visible surface bloom 31–44 h out. Cartridge CT-2291 released automatically at 04:12.',
    mins:22, buoy:'BG-014', unread:true, acts:[['View sensors','sensors'],['Cartridge log','cartridges']] },
  { id:'a2', sev:'high', icon:'ic-drop',  color:'#E8562A', title:'Dissolved oxygen below floor',
    body:'BG-033 Clear Lake reading 5.2 mg/L, under the 6.0 mg/L floor for 4 consecutive samples. Overnight respiration from existing biomass is the likely driver.',
    mins:96, buoy:'BG-033', unread:true, acts:[['Open map','home']] },
  { id:'a3', sev:'warn', icon:'ic-cartridge', color:'#F0A32E', title:'Cartridge stock low — BG-033',
    body:'1 cartridge remaining on board and risk trending up. Schedule a resupply run before the next forecast warm spell.',
    mins:210, buoy:'BG-033', unread:false, acts:[['Cartridge log','cartridges']] },
  { id:'a4', sev:'info', icon:'ic-leaf',  color:'#1B6CA8', title:'Holding tank 81% full — BG-033',
    body:'Skimmer throughput 4.8 kg/day. Return-to-shore digester run recommended within 2 days to avoid a skimmer pause.',
    mins:340, buoy:'BG-033', unread:false, acts:[['Harvest','harvest']] },
  { id:'a5', sev:'ok',   icon:'ic-check', color:'#3FA34D', title:'Knockdown confirmed — BG-046',
    body:'Chlorophyll-a down 83% 30 h after CT-2255. Risk returned to Low. Cartridge housing retrieved and logged.',
    mins:1490, buoy:'BG-046', unread:false, acts:[['Cartridge log','cartridges']] }
];

/* ============================================================
   CHART PRIMITIVES  (hand-rolled SVG, no dependencies)
   ============================================================ */
function sparkPath(arr, w, h, pad){
  pad = pad == null ? 2 : pad;
  const min = Math.min.apply(null, arr), max = Math.max.apply(null, arr);
  const span = (max - min) || 1;
  return arr.map((v, i) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
}

function sparkline(arr, color, w, h){
  w = w || 120; h = h || 26;
  const d = sparkPath(arr, w, h);
  const area = d + ` L${w} ${h} L0 ${h} Z`;
  const uid = 'sp' + Math.random().toString(36).slice(2, 8);
  return `<svg class="tile__spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".26"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${uid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function barChart(bars, max){
  const W = 300, H = 150, padL = 30, padB = 22, padT = 6;
  const iw = W - padL - 6, ih = H - padB - padT;
  const bw = Math.min(46, iw / bars.length * 0.5);
  const step = iw / bars.length;
  let g = '';
  for (let i = 0; i <= 5; i++){
    const y = padT + ih - (ih / 5) * i;
    g += `<line class="grid-l" x1="${padL}" y1="${y}" x2="${W - 6}" y2="${y}"/>
          <text class="axis-txt" x="${padL - 6}" y="${y + 3}" text-anchor="end">${Math.round(max / 5 * i)}</text>`;
  }
  const b = bars.map((d, i) => {
    const hgt = Math.max(2, (d.v / max) * ih);
    const x = padL + step * i + (step - bw) / 2;
    const y = padT + ih - hgt;
    return `<rect class="bar" x="${x}" y="${y}" width="${bw}" height="${hgt}" rx="3" fill="${d.c}" style="animation-delay:${i * 90}ms"/>
            <text class="bar-lbl" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.l)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}">${g}${b}</svg>`;
}

function lineChart(series, labels){
  const W = 300, H = 128, padL = 26, padB = 20, padT = 8, padR = 8;
  const iw = W - padL - padR, ih = H - padB - padT;
  const X = i => padL + (i / (labels.length - 1)) * iw;

  let g = '';
  for (let i = 0; i <= 3; i++){
    const y = padT + ih - (ih / 3) * i;
    g += `<line class="grid-l" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`;
  }
  const xt = labels.map((l, i) =>
    `<text class="axis-txt" x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`).join('');

  /* Each series is scaled to its own min/max — the channels have very
     different units, so a shared axis would flatten one of them. The
     legend carries the real range for each. */
  const lines = series.map(s => {
    const min = Math.min.apply(null, s.pts), max = Math.max.apply(null, s.pts);
    const span = (max - min) || 1;
    const Y = v => padT + ih * 0.08 + (ih * 0.84) * (1 - (v - min) / span);
    const d = s.pts.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    const dots = s.pts.map((v, i) =>
      `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.6" fill="#fff" stroke="${s.color}" stroke-width="1.8"/>`).join('');
    return `<path class="linepath" d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}">${g}${xt}${lines}</svg>`;
}

/* semicircular bloom-risk gauge */
function gauge(score, band){
  const LEN = 245.04;                       // π · r  with r = 78
  const off = LEN * (1 - score / 100);
  return `<div class="gauge">
    <svg class="gauge__svg" viewBox="0 0 190 118">
      <defs>
        <linearGradient id="gRisk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0"   stop-color="#3FA34D"/>
          <stop offset=".42" stop-color="#F0A32E"/>
          <stop offset=".72" stop-color="#E8562A"/>
          <stop offset="1"   stop-color="#DE3B3B"/>
        </linearGradient>
      </defs>
      <path d="M17 95 A78 78 0 0 1 173 95" fill="none" stroke="#E9F0F5" stroke-width="15" stroke-linecap="round"/>
      <path data-live="risk-arc" d="M17 95 A78 78 0 0 1 173 95" fill="none" stroke="url(#gRisk)"
            stroke-width="15" stroke-linecap="round"
            stroke-dasharray="${LEN}" stroke-dashoffset="${off.toFixed(1)}"
            style="transition:stroke-dashoffset .8s cubic-bezier(.3,.9,.3,1)"/>
      <text class="axis-txt" x="17"  y="112" text-anchor="middle">0</text>
      <text class="axis-txt" x="173" y="112" text-anchor="middle">100</text>
    </svg>
    <div class="gauge__val">
      <div class="gauge__num" data-live="risk-num">${score}</div>
      <div class="gauge__unit">bloom risk</div>
    </div>
  </div>
  <div style="text-align:center">
    <span class="riskchip ${band.cls}" data-live="risk-chip">${ic('ic-warn')}${band.label} risk</span>
  </div>`;
}

/* ============================================================
   SHARED CHROME
   ============================================================ */
function tabbar(active){
  const tabs = [['home','ic-pin'], ['analytics','ic-chart'], ['profile','ic-user']];
  return `<nav class="tabbar">${tabs.map(([k, i]) => `
    <button class="tab ${active === k ? 'is-on' : ''}" data-goto="${k}" aria-label="${k}">
      ${ic(i)}
    </button>`).join('')}</nav>`;
}

/* Home app bar: the alerts bell takes the slot the drawer button used
   to occupy, so notifications are one tap from the map. */
function barMap(){
  const unread = state.alerts.filter(a => a.unread).length;
  return `<header class="appbar">
    <svg class="appbar__logo" viewBox="0 0 120 120"><use href="#logo-mark"/></svg>
    <span class="appbar__title">Fleet Map</span>
    <button class="appbar__btn appbar__bell" data-goto="alerts" aria-label="Alerts">
      ${ic('ic-bell')}
      ${unread ? `<span class="appbar__badge" data-badge>${unread}</span>` : ''}
    </button>
  </header>`;
}

function shell(bar, body, active, viewClass){
  return bar + `<div class="view ${viewClass || ''}" id="view">${body}</div>` + tabbar(active);
}

function barPlain(title, backTo){
  return `<header class="appbar">
    ${backTo ? `<button class="appbar__btn" data-goto="${backTo}" aria-label="Back">${ic('ic-back')}</button>`
             : `<svg class="appbar__logo" viewBox="0 0 120 120"><use href="#logo-mark"/></svg>`}
    <span class="appbar__title">${esc(title)}</span>
    <button class="appbar__btn" data-action="open-drawer" aria-label="Menu">${ic('ic-menu')}</button>
  </header>`;
}

/* ============================================================
   SCREEN — LOGIN
   ============================================================ */
function ScreenLogin(){
  return `<div class="login">
    <svg class="login__waves" viewBox="0 0 400 800" preserveAspectRatio="none" aria-hidden="true">
      <path d="M-20 620 C 90 570 150 690 260 640 S 420 590 440 630 L440 820 L-20 820Z" fill="rgba(127,216,232,.10)"/>
      <path d="M-20 680 C 80 640 170 740 280 690 S 420 660 440 690 L440 820 L-20 820Z" fill="rgba(127,216,232,.08)"/>
      <path d="M-20 120 C 60 80 120 170 210 130 S 380 70 440 110" fill="none" stroke="rgba(127,216,232,.22)" stroke-width="2"/>
    </svg>
    <div class="login__dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>

    <div class="login__top">
      <svg class="login__logo" viewBox="0 0 120 120"><use href="#logo-mark"/></svg>
      <h1 class="login__title">Freshwater<span>Future</span></h1>
      <p class="login__sub">Tracker App</p>

      <form class="login__fields" id="loginForm" autocomplete="on">
        <label class="ifield">
          ${ic('ic-mail')}
          <input id="fEmail" type="text" placeholder="Email or Phone" value="ops@toledowater.gov"
                 autocomplete="username" spellcheck="false" />
        </label>
        <label class="ifield">
          ${ic('ic-lock')}
          <input id="fPass" type="password" placeholder="Password" value="bloomguard"
                 autocomplete="current-password" />
        </label>
        <div class="login__err" id="loginErr"></div>
      </form>
    </div>

    <div class="login__sheet">
      <div class="login__forgot">Forgot Password?</div>
      <button class="btn btn--primary btn--block" data-action="login">Login</button>
      <div class="or">or</div>
      <button class="btn btn--ghost btn--block" data-action="login">Create an account</button>
    </div>
  </div>`;
}

/* ============================================================
   SCREEN — LIVE SENSOR DASHBOARD
   ============================================================ */
function tile(key, hist, wide){
  const spec = BB.SENSORS[key];
  const arr  = hist[key];
  const v    = arr[arr.length - 1];
  const prev = arr[Math.max(0, arr.length - 9)];
  const d    = v - prev;
  const dir  = Math.abs(d) < (spec.span[1] - spec.span[0]) * 0.004 ? 'flat' : (d > 0 ? 'up' : 'down');
  const arrow= dir === 'flat' ? '→' : (dir === 'up' ? '↑' : '↓');
  const out  = BB.isOutOfBand(spec, v);
  return `<div class="tile ${wide ? 'tile--wide' : ''} ${out ? 'is-out' : ''}" data-tile="${key}">
    <div class="tile__top">
      <span class="tile__ic" style="background:${spec.color}">${ic(spec.icon)}</span>
      <span class="tile__name">${spec.name}</span>
    </div>
    <div class="tile__val" data-live-val="${key}">${BB.fmt(key, v)}<small>${spec.unit}</small></div>
    <div data-live-spark="${key}">${sparkline(arr, spec.color, wide ? 260 : 120, 26)}</div>
    <div class="tile__foot">
      <span class="tile__delta ${dir}" data-live-delta="${key}">${arrow} ${Math.abs(d).toFixed(spec.dp)} over 2 h</span>
      <span data-live-flag="${key}">${out ? '<span class="tile__flag">OUT OF BAND</span>' : ''}</span>
    </div>
  </div>`;
}

function ScreenSensors(){
  const b = buoy(), hist = state.hist[b.id], r = readings(), risk = riskOf(), band = BB.riskBand(risk);
  const drivers = BB.riskDrivers(r).slice(0, 5);
  const canDeploy = b.cartridges > 0;

  const body = `
    <div class="page-head">
      <h2>Live<span class="thin">Sensors</span></h2>
      <p>${esc(b.name)} · ${esc(b.id)} · ${BB.coord(b.lat, b.lon)}</p>
    </div>

    <div class="card card--pad">
      ${gauge(risk, band)}
      <div class="gauge__foot">
        <span>Updated ${state.fast ? '0.7' : '1.6'}s ago</span><span>·</span>
        <span>Alert threshold ${state.thresholds.risk}</span>
      </div>
    </div>

    <div class="card card--pad">
      <div class="card__title"><h3>What is driving the score</h3><span>weighted</span></div>
      <div class="drivers" data-live="drivers">${driversHTML(drivers)}</div>
      <div class="note" style="margin:12px 0 0">
        <b>Why AVOCs matter.</b> Volatile organics shift with algal metabolism <i>before</i> biomass is
        visible at the surface, so they give the model a genuine head start over satellite or eyeball detection.
      </div>
    </div>

    <div class="sec-label">Primary channels</div>
    <div class="tiles">
      ${tile('ph', hist)}${tile('do', hist)}
      ${tile('voc', hist)}${tile('temp', hist)}
    </div>

    <div class="sec-label">Bloom biomass</div>
    <div class="tiles">
      ${tile('chl', hist)}${tile('pc', hist)}
    </div>

    <div class="sec-label">Nutrient load &amp; clarity</div>
    <div class="tiles">
      ${tile('nitrate', hist)}${tile('phosphate', hist)}
      ${tile('turbidity', hist, true)}
    </div>

    <div class="btnrow">
      <button class="actionbtn actionbtn--danger" data-action="deploy" ${canDeploy ? '' : 'disabled'}>
        ${ic('ic-cartridge')} Deploy cartridge
      </button>
      <button class="actionbtn actionbtn--solid" data-action="simulate">
        ${ic('ic-bolt')} Simulate bloom
      </button>
    </div>

    <div class="card card--pad">
      <div class="card__title"><h3>Buoy telemetry</h3><span>${esc(b.id)}</span></div>
      <div class="kv"><span>Battery</span><b>${b.battery}%</b></div>
      <div class="kv"><span>Solar yield today</span><b>${b.solar} Wh</b></div>
      <div class="kv"><span>Sonar depth</span><b>${b.depth} m</b></div>
      <div class="kv"><span>Cartridges on board</span><b>${b.cartridges}</b></div>
      <div class="kv"><span>Deployed since</span><b>${b.deployed}</b></div>
    </div>`;

  return shell(barPlain('Live Sensor Dashboard', 'home'), body, 'home');
}

function driversHTML(drivers){
  return drivers.map(d => `
    <div class="driver">
      <b>${d.name}</b>
      <div class="prog"><div class="prog__fill" style="width:${d.pct}%;background:${d.color}"></div></div>
      <span>${d.pct}%</span>
    </div>`).join('');
}

/* ============================================================
   SCREEN — STATISTICS
   Fleet-wide first (how full are the holding tanks, how many buoys
   are carrying a full algicide load), then per-buoy detail at the
   bottom for anyone who wants to drill in.
   ============================================================ */
function fleetTotals(){
  const held = BB.FLEET.reduce((a, b) => a + b.tank / 100 * b.tankCap, 0);
  const cap  = BB.FLEET.reduce((a, b) => a + b.tankCap, 0);
  const carts = BB.FLEET.reduce((a, b) => a + b.cartridges, 0);
  const cartCap = BB.FLEET.length * BB.CART_BAY;
  return {
    held, cap, pct: Math.round(held / cap * 100),
    carts, cartCap, cartPct: Math.round(carts / cartCap * 100),
    full: BB.FLEET.filter(b => b.cartridges >= BB.CART_BAY).length,
    low:  BB.FLEET.filter(b => b.cartridges <= 1).length,
    needService: BB.FLEET.filter(b => b.tank >= 75).length
  };
}

function ScreenAnalytics(){
  const s = BB.SUMMARY[state.range];
  const t = fleetTotals();

  /* algicide load, emptiest first — that is the list you act on */
  const byLoad = BB.FLEET.slice().sort((a, b) => a.cartridges - b.cartridges);
  /* holding tank, fullest first — those need collecting */
  const byTank = BB.FLEET.slice().sort((a, b) => b.tank - a.tank);

  const body = `
    <div class="segs">
      ${['daily','weekly','monthly','yearly'].map(k => `
        <button class="seg ${state.range === k ? 'is-on' : ''}" data-range="${k}">
          ${k[0].toUpperCase() + k.slice(1)}
        </button>`).join('')}
    </div>

    <!-- fleet holding tanks -->
    <div class="card card--pad">
      <div class="card__title"><h3>Algae held across the fleet</h3><span>${BB.FLEET.length} buoys</span></div>
      <div class="bigstat__row">
        <span class="bigstat__num">${Math.round(t.held)}</span>
        <span class="bigstat__unit">KG OF ${t.cap} CAPACITY</span>
      </div>
      <div class="prog ${t.pct > 75 ? 'prog--amber' : 'prog--leaf'}" style="margin-top:10px">
        <div class="prog__fill" style="width:${t.pct}%"></div>
      </div>
      <div class="kv" style="margin-top:10px"><span>Fleet tanks</span><b>${t.pct}% full</b></div>
      <div class="kv"><span>Skimmed this ${state.range.replace('ly','')}</span><b>${s.collected} kg</b></div>
      <div class="kv"><span>Buoys due for collection</span>
        <b style="color:${t.needService ? 'var(--coral)' : 'var(--leaf-dark)'}">${t.needService}</b></div>
    </div>

    <!-- algicide readiness -->
    <div class="card card--pad">
      <div class="card__title"><h3>Algicide readiness</h3><span>${t.carts}/${t.cartCap} cartridges</span></div>
      <div class="bigstat__row">
        <span class="bigstat__num" style="color:${t.full === BB.FLEET.length ? 'var(--leaf-dark)' : 'var(--ocean-800)'}">${t.full}</span>
        <span class="bigstat__unit">OF ${BB.FLEET.length} BUOYS FULLY LOADED</span>
      </div>
      <div class="prog ${t.cartPct < 50 ? 'prog--danger' : t.cartPct < 80 ? 'prog--amber' : 'prog--leaf'}" style="margin-top:10px">
        <div class="prog__fill" style="width:${t.cartPct}%"></div>
      </div>
      ${t.low ? `<div class="note" style="margin:11px 0 0">
        <b>${t.low} buoy${t.low > 1 ? 's' : ''} at or below one cartridge.</b>
        Schedule a resupply before the next warm spell — a buoy with an empty bay can still
        predict a bloom but cannot act on it.</div>` : ''}
    </div>

    <!-- per-buoy algicide tanks -->
    <div class="sec-label">Algicide on board</div>
    <div class="rows">
      ${byLoad.map(b => {
        const pct = Math.round(b.cartridges / BB.CART_BAY * 100);
        const tone = b.cartridges >= BB.CART_BAY ? 'b-green' : b.cartridges <= 1 ? 'b-red' : 'b-amber';
        return `<div class="statrow">
          <div class="statrow__top">
            <b>${esc(b.name)}</b>
            <span class="badge ${tone}">${b.cartridges}/${BB.CART_BAY}</span>
          </div>
          <div class="capbar capbar--light">
            ${Array.from({ length: BB.CART_BAY }, (_, i) => `<i class="${i < b.cartridges ? 'on' : ''}"></i>`).join('')}
          </div>
          <div class="statrow__foot">
            <span>${esc(b.id)}</span>
            <span>${(b.cartridges * BB.CART_LITRES).toFixed(1)} L of strain 6A1 · ${pct}%</span>
          </div>
        </div>`;
      }).join('')}
    </div>

    <!-- per-buoy holding tanks -->
    <div class="sec-label">Holding tanks</div>
    <div class="rows">
      ${byTank.map(b => `
        <div class="statrow">
          <div class="statrow__top">
            <b>${esc(b.name)}</b>
            <span class="badge ${b.tank >= 75 ? 'b-red' : b.tank >= 40 ? 'b-amber' : 'b-green'}">${b.tank}%</span>
          </div>
          <div class="prog ${b.tank >= 75 ? 'prog--amber' : 'prog--leaf'}">
            <div class="prog__fill" style="width:${b.tank}%"></div>
          </div>
          <div class="statrow__foot">
            <span>${esc(b.id)}</span>
            <span>${Math.round(b.tank / 100 * b.tankCap)} of ${b.tankCap} kg</span>
          </div>
        </div>`).join('')}
    </div>

    <!-- period activity -->
    <div class="sec-label">${state.range[0].toUpperCase() + state.range.slice(1)} activity</div>
    <div class="chartbox">${barChart(s.bars, s.max)}</div>
    <div class="card card--pad">
      <div class="card__title"><h3>Resource recovery</h3><span>shore digester</span></div>
      <div class="kv"><span>Biogas produced</span><b>${s.bars[2].v} m³</b></div>
      <div class="kv"><span>Methane fraction</span><b>≈ 65%</b></div>
      <div class="kv"><span>Energy returned</span><b>${(s.bars[2].v * 6.1).toFixed(0)} kWh<sub>e</sub></b></div>
      ${s.kpis.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
    </div>

    <!-- drill-down -->
    <div class="sec-label">Detailed insights</div>
    <p class="sec-note">Open any buoy for its live sensor channels, bloom-risk breakdown and telemetry.</p>
    <div class="rows">
      ${BB.FLEET.map(b => {
        const risk = riskOf(b.id), band = BB.riskBand(risk);
        return `<button class="row" data-buoy="${b.id}">
          <span class="row__ic" style="background:${band.color}">${ic('ic-wave')}</span>
          <span class="row__main">
            <b>${esc(b.name)}</b>
            <small>${esc(b.id)} · ${esc(b.org)}<br>${b.cartridges}/${BB.CART_BAY} cartridges · tank ${b.tank}% · batt ${b.battery}%</small>
          </span>
          <span class="row__end">
            <span class="big" style="color:${band.color}">${risk}</span>
            <span class="badge ${band.key === 'low' ? 'b-green' : band.key === 'mod' ? 'b-amber' : 'b-red'}">${band.label}</span>
          </span>
        </button>`;
      }).join('')}
    </div>`;

  return shell(barPlain('Statistics'), body, 'analytics');
}

/* ============================================================
   MAP  (home screen)
   ------------------------------------------------------------
   Equirectangular. Coastlines and buoy markers share one projection
   (BB.projX / BB.projY) so every pin sits at its true lat/lon, and
   working in degree units keeps that verifiable: x=96.8 IS lon -83.2.

   The view is a windowed viewBox rather than a fitted one. At zoom 1
   the window is exactly 180deg of latitude tall, so it always fills
   the screen vertically with no empty band -- only a slice of
   longitude is visible, and you pan to reach the rest.
   ============================================================ */
const WORLD = { w:360, h:180 };
const PIN_SEP_PX = 26;      /* keep markers this far apart on screen */
const MAX_ZOOM = 8;   /* coastlines are coarse; past this it just looks blocky */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Current window in map units, derived from centre + zoom + container. */
function mapWindow(rect){
  const A = rect.width / rect.height;
  let h = WORLD.h / state.map.zoom;
  let w = h * A;
  if (w > WORLD.w){ w = WORLD.w; h = w / A; }
  const cx = w >= WORLD.w ? WORLD.w / 2 : clamp(state.map.cx, w / 2, WORLD.w - w / 2);
  const cy = h >= WORLD.h ? WORLD.h / 2 : clamp(state.map.cy, h / 2, WORLD.h - h / 2);
  state.map.cx = cx; state.map.cy = cy;
  return { x:cx - w / 2, y:cy - h / 2, w, h, scale:h / rect.height };
}

/* Spread markers that would overlap on screen, keeping a leader line
   back to the true position. Recomputed per zoom because the required
   separation in degrees shrinks as you zoom in. */
function layoutPins(rows, minSep){
  const pins = rows.map(({ b, risk, band }) => ({
    id:b.id, name:b.name, risk, band,
    x:BB.projX(b.lon), y:BB.projY(b.lat),
    mx:BB.projX(b.lon), my:BB.projY(b.lat)
  }));
  for (let iter = 0; iter < 200; iter++){
    let moved = false;
    for (let i = 0; i < pins.length; i++){
      for (let j = i + 1; j < pins.length; j++){
        const a = pins[i], c = pins[j];
        let dx = c.mx - a.mx, dy = c.my - a.my;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.001){ dx = 0.6; dy = 0.4; d = 0.72; }
        if (d < minSep){
          const push = (minSep - d) / 2 * 0.8;
          dx /= d; dy /= d;
          a.mx -= dx * push; a.my -= dy * push;
          c.mx += dx * push; c.my += dy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return pins;
}

/* Markers are drawn at origin and scaled by `s` so they stay the same
   size on screen at every zoom level. Names appear once there is room
   for them, which is roughly zoom 1.8 and up. */
function pinsMarkup(rows, s){
  const showLabels = state.map.zoom >= 1.8;
  return layoutPins(rows, PIN_SEP_PX * s).map(p => {
    const off = Math.sqrt((p.mx - p.x) ** 2 + (p.my - p.y) ** 2) > s * 2;
    const hot = p.band.key === 'crit' || p.band.key === 'high';
    const sel = p.id === state.map.selected;
    return `<g class="wm-pin ${sel ? 'is-sel' : ''}" data-pin="${p.id}" role="button" tabindex="0"
               aria-label="${esc(p.name)}, bloom risk ${p.risk}">
      <title>${esc(p.name)} — risk ${p.risk}</title>
      ${off ? `<line class="wm-lead" x1="${p.x.toFixed(2)}" y1="${p.y.toFixed(2)}"
                     x2="${p.mx.toFixed(2)}" y2="${p.my.toFixed(2)}"
                     stroke="${p.band.color}" vector-effect="non-scaling-stroke"/>
               <g transform="translate(${p.x.toFixed(2)},${p.y.toFixed(2)}) scale(${s})">
                 <circle r="2.6" fill="#fff"/><circle r="1.5" fill="${p.band.color}"/>
               </g>` : ''}
      <g transform="translate(${p.mx.toFixed(2)},${p.my.toFixed(2)}) scale(${s})">
        ${hot ? `<circle class="wm-ping" r="6" fill="${p.band.color}"/>` : ''}
        <g filter="url(#wmPinShadow)">
          <circle class="wm-halo" r="8" fill="#fff"/>
          <circle r="6.1" fill="${p.band.color}"/>
          <circle r="6.1" fill="url(#wmPinGloss)"/>
          <circle r="2.1" fill="#fff" opacity=".95"/>
        </g>
        ${sel ? `<circle class="wm-ring" r="12" fill="none" stroke="${p.band.color}" stroke-width="1.6" opacity=".9"/>` : ''}
        ${showLabels ? `<text class="wm-label" x="13" y="4.6" paint-order="stroke"
              stroke="#F4FAFD" stroke-width="3.4" stroke-linejoin="round">${esc(p.name)}</text>` : ''}
        <circle r="14" fill="transparent"/>
      </g>
    </g>`;
  }).join('');
}

function worldMap(rows){
  const rings = BB.LANDMASSES.map(ring =>
    `<path d="${ring.map((p, i) => (i ? 'L' : 'M') + BB.projX(p[0]).toFixed(1) + ' ' + BB.projY(p[1]).toFixed(1)).join(' ')}Z"/>`
  ).join('');

  let grat = '';
  for (let lon = -150; lon <= 150; lon += 30){
    grat += `<line x1="${BB.projX(lon)}" y1="0" x2="${BB.projX(lon)}" y2="180" vector-effect="non-scaling-stroke"/>`;
  }
  for (let lat = -60; lat <= 60; lat += 30){
    grat += `<line x1="0" y1="${BB.projY(lat)}" x2="360" y2="${BB.projY(lat)}" vector-effect="non-scaling-stroke"/>`;
  }

  return `<div class="worldmap" id="worldmap">
    <svg id="wmSvg" viewBox="0 0 360 180" preserveAspectRatio="none"
         role="img" aria-label="World map of ${rows.length} monitoring buoys">
      <defs>
        <!-- userSpaceOnUse so the ramp tracks latitude, not the oversized
             backdrop rect: warm and shallow at the equator, colder toward
             the poles, and it clamps naturally past them -->
        <linearGradient id="wmSea" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="180">
          <stop offset="0"   stop-color="#8FB9D4"/>
          <stop offset=".28" stop-color="#B4D6E8"/>
          <stop offset=".5"  stop-color="#CBE5F1"/>
          <stop offset=".72" stop-color="#B4D6E8"/>
          <stop offset="1"   stop-color="#8FB9D4"/>
        </linearGradient>
        <linearGradient id="wmLand" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="180">
          <stop offset="0"  stop-color="#EDEEDC"/>
          <stop offset=".5" stop-color="#F4F2E3"/>
          <stop offset="1"  stop-color="#E6E8D2"/>
        </linearGradient>
        <radialGradient id="wmPinGloss" cx=".35" cy=".3" r=".8">
          <stop offset="0" stop-color="#fff" stop-opacity=".45"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
        <filter id="wmPinShadow" x="-70%" y="-70%" width="240%" height="240%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.3" flood-color="#06293F" flood-opacity=".38"/>
        </filter>
      </defs>

      <rect x="-400" y="-400" width="1160" height="980" fill="url(#wmSea)"/>
      <g class="wm-grat">${grat}</g>
      <line class="wm-eq" x1="0" y1="90" x2="360" y2="90" vector-effect="non-scaling-stroke"/>

      <!-- continental shelf: the same rings stroked wide-to-narrow in
           white gives coastlines a soft glow instead of a hard edge -->
      <g class="wm-shelf wm-shelf--3">${rings}</g>
      <g class="wm-shelf wm-shelf--2">${rings}</g>
      <g class="wm-shelf wm-shelf--1">${rings}</g>
      <g class="wm-land">${rings}</g>

      <g id="wmPins"></g>
    </svg>

    <div class="map-zoom">
      <button data-action="zoom-in" aria-label="Zoom in">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round"/></svg>
      </button>
      <button data-action="zoom-out" aria-label="Zoom out">
        <svg viewBox="0 0 24 24"><path d="M5 12h14" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round"/></svg>
      </button>
      <button data-action="zoom-next" aria-label="Jump to next buoy" title="Jump to next buoy">
        ${ic('ic-pin')}
      </button>
    </div>

    <div class="map-legend">
      <b>Bloom risk</b>
      <span><i style="background:#3FA34D"></i>Low</span>
      <span><i style="background:#F0A32E"></i>Elevated</span>
      <span><i style="background:#E8562A"></i>High</span>
      <span><i style="background:#DE3B3B"></i>Critical</span>
    </div>
  </div>`;
}

/* ---- view application + interaction ---- */
let mapRows = [];
let lastPinScale = -1;

function applyMapView(force, tries){
  const wrap = $('#worldmap'), svg = $('#wmSvg');
  if (!wrap || !svg) return;
  const rect = wrap.getBoundingClientRect();
  /* Called straight after innerHTML the container can still be unsized.
     Bailing without a retry left the markers permanently unrendered. */
  if (!rect.width || !rect.height){
    const n = tries || 0;
    if (n < 30) requestAnimationFrame(() => applyMapView(force, n + 1));
    return;
  }
  const win = mapWindow(rect);
  svg.setAttribute('viewBox',
    `${win.x.toFixed(3)} ${win.y.toFixed(3)} ${win.w.toFixed(3)} ${win.h.toFixed(3)}`);
  /* re-lay markers only when the scale actually changed — panning is free */
  if (force || Math.abs(win.scale - lastPinScale) > 1e-4){
    lastPinScale = win.scale;
    $('#wmPins').innerHTML = pinsMarkup(mapRows, win.scale);
  }
}

function zoomBy(factor, clientX, clientY){
  const wrap = $('#worldmap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const before = mapWindow(rect);
  const px = clientX == null ? rect.width / 2 : clientX - rect.left;
  const py = clientY == null ? rect.height / 2 : clientY - rect.top;
  /* map coordinate under the cursor, held fixed across the zoom */
  const ax = before.x + (px / rect.width) * before.w;
  const ay = before.y + (py / rect.height) * before.h;

  state.map.zoom = clamp(state.map.zoom * factor, 1, MAX_ZOOM);
  const after = mapWindow(rect);
  state.map.cx = ax - (px / rect.width - 0.5) * after.w;
  state.map.cy = ay - (py / rect.height - 0.5) * after.h;
  applyMapView(true);
}

/* The fleet spans 240deg of longitude but the zoom-1 window is only as
   wide as the screen aspect allows (~100deg), so "fit everything" is not
   reachable without reintroducing empty bands. This cycles through the
   buoys worst-first instead, which is what you actually want to do. */
function jumpToBuoy(){
  if (!mapRows.length) return;
  const m = state.map;
  m.focusIdx = (m.focusIdx == null ? -1 : m.focusIdx) + 1;
  if (m.focusIdx >= mapRows.length) m.focusIdx = 0;
  const r = mapRows[m.focusIdx];
  m.zoom = Math.max(m.zoom, 2.6);
  m.cx = BB.projX(r.b.lon);
  m.cy = BB.projY(r.b.lat);
  applyMapView();
  flashMapLabel(`${r.b.name} · risk ${r.risk}`);
}

function flashMapLabel(text){
  const wrap = $('#worldmap');
  if (!wrap) return;
  let el = $('.map-flash', wrap);
  if (!el){
    el = document.createElement('div');
    el.className = 'map-flash';
    wrap.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('is-out');
  clearTimeout(flashMapLabel._t);
  flashMapLabel._t = setTimeout(() => el.classList.add('is-out'), 1800);
}

function initMap(rows){
  mapRows = rows;
  lastPinScale = -1;
  const wrap = $('#worldmap'), svg = $('#wmSvg');
  if (!wrap || !svg) return;
  applyMapView(true);

  const pointers = new Map();
  let panning = false, moved = 0, lastX = 0, lastY = 0, pinchDist = 0;

  svg.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 1){ panning = true; moved = 0; lastX = e.clientX; lastY = e.clientY; }
    if (pointers.size === 2){
      panning = false;
      const [a, b] = Array.from(pointers.values());
      pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    }
  });

  svg.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });

    if (pointers.size === 2){
      const [a, b] = Array.from(pointers.values());
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (pinchDist > 0 && d > 0){
        zoomBy(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        moved += Math.abs(d - pinchDist);
      }
      pinchDist = d;
      return;
    }

    if (!panning) return;
    const rect = wrap.getBoundingClientRect();
    const win = mapWindow(rect);
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    state.map.cx -= dx * win.w / rect.width;
    state.map.cy -= dy * win.h / rect.height;
    lastX = e.clientX; lastY = e.clientY;
    applyMapView();
  });

  const release = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0){
      panning = false;
      /* a drag must not also register as a tap on a marker */
      if (moved > 6){ svg.dataset.dragged = '1'; setTimeout(() => { delete svg.dataset.dragged; }, 0); }
    }
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(Math.pow(0.9985, e.deltaY), e.clientX, e.clientY);
  }, { passive:false });

  svg.addEventListener('dblclick', e => { e.preventDefault(); zoomBy(1.8, e.clientX, e.clientY); });

  if (!initMap._resize){
    initMap._resize = true;
    window.addEventListener('resize', () => applyMapView(true));
  }
}

/* ============================================================
   SCREEN — FLEET
   ============================================================ */
function ScreenHome(){
  const rows = BB.FLEET.map(b => {
    const risk = riskOf(b.id);
    return { b, risk, band: BB.riskBand(risk) };
  }).sort((x, y) => y.risk - x.risk);

  return shell(barMap(), worldMap(rows), 'home', 'view--map');
}

/* ============================================================
   SCREEN — ALERTS
   ============================================================ */
function ScreenAlerts(){
  const body = `
<div class="rows">
      ${state.alerts.map(a => `
        <div class="alert alert--${a.sev} ${a.unread ? 'is-unread' : ''}" data-alert="${a.id}">
          <span class="alert__ic" style="background:${a.color}">${ic(a.icon)}</span>
          <div>
            <div class="alert__head"><b>${esc(a.title)}</b><time>${BB.ago(a.mins)}</time></div>
            <p>${esc(a.body)}</p>
            <div class="alert__acts">
              ${a.acts.map(([lbl, go], i) =>
                `<button class="minibtn ${i === 0 ? 'minibtn--solid' : ''}" data-goto="${go}" data-buoy-soft="${a.buoy}">${esc(lbl)}</button>`
              ).join('')}
              ${a.unread ? `<button class="minibtn" data-action="read" data-alert="${a.id}">Mark read</button>` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>

    <div class="sec-label">Notification rules</div>
    <div class="card card--pad">
      <div class="thresh">
        <div class="thresh__row">
          <label>Bloom-risk alert threshold <span id="thRiskVal">${state.thresholds.risk}</span></label>
          <input type="range" min="20" max="95" step="1" value="${state.thresholds.risk}" data-th="risk" />
        </div>
        <div class="thresh__row">
          <label>Dissolved-oxygen floor <span id="thDoVal">${state.thresholds.doFloor.toFixed(1)} mg/L</span></label>
          <input type="range" min="2" max="9" step="0.1" value="${state.thresholds.doFloor}" data-th="doFloor" />
        </div>
      </div>
      <div style="margin-top:6px">
        <div class="tgl">
          <span class="tgl__txt"><b>Push notifications</b><small>Send to this device when a rule trips</small></span>
          <button class="switch ${state.thresholds.pushEnabled ? 'is-on' : ''}" data-toggle="pushEnabled" aria-label="Push notifications"></button>
        </div>
        <div class="tgl">
          <span class="tgl__txt"><b>Auto-deploy cartridge</b><small>Release without waiting for approval above threshold</small></span>
          <button class="switch ${state.thresholds.autoDeploy ? 'is-on' : ''}" data-toggle="autoDeploy" aria-label="Auto deploy"></button>
        </div>
        <div class="tgl">
          <span class="tgl__txt"><b>Quiet hours</b><small>Hold non-critical alerts 22:00 – 06:00</small></span>
          <button class="switch ${state.thresholds.quiet ? 'is-on' : ''}" data-toggle="quiet" aria-label="Quiet hours"></button>
        </div>
      </div>
    </div>

    <div class="btnrow">
      <button class="actionbtn" data-action="test-push">${ic('ic-bell')} Test push</button>
      <button class="actionbtn" data-action="read-all">${ic('ic-check')} Mark all read</button>
    </div>`;

  return shell(barPlain('Alerts'), body, 'alerts');
}

/* ============================================================
   SCREEN — CARTRIDGE LOG
   ============================================================ */
const CART_STATE = {
  loaded:   { badge:'b-blue',  label:'Loaded',    color:'#1B6CA8', icon:'ic-cartridge' },
  deployed: { badge:'b-amber', label:'Deployed',  color:'#F0A32E', icon:'ic-bolt' },
  spent:    { badge:'b-grey',  label:'Awaiting retrieval', color:'#7C93A6', icon:'ic-warn' },
  retrieved:{ badge:'b-green', label:'Retrieved', color:'#3FA34D', icon:'ic-check' }
};

function ScreenCartridges(){
  const b = buoy();
  const total = state.cartridges.length;
  const active = state.cartridges.filter(c => c.state === 'deployed').length;
  const pending = state.cartridges.filter(c => c.state === 'spent').length;
  const kills = state.cartridges.filter(c => c.kill != null).map(c => c.kill);
  const avgKill = kills.length ? Math.round(kills.reduce((a, x) => a + x, 0) / kills.length) : 0;
  const onboard = b.cartridges;

  const body = `
    <div class="cart-hero">
      <h3>Cartridge bay — ${esc(b.id)}</h3>
      <div class="sub">${esc(b.name)} · algicidal strain 6A1</div>
      <div class="capbar">${Array.from({ length: 6 }, (_, i) => `<i class="${i < onboard ? 'on' : ''}"></i>`).join('')}</div>
      <div class="cart-hero__grid">
        <div class="cart-hero__cell"><b>${onboard}/6</b><small>On board</small></div>
        <div class="cart-hero__cell"><b>${avgKill}%</b><small>Avg knockdown</small></div>
        <div class="cart-hero__cell"><b>${pending}</b><small>To retrieve</small></div>
      </div>
    </div>

    <div class="note">
      <b>Why a cartridge, not a dose.</b> Algicidal compounds are secreted into the water — the bacteria
      never have to contact the algae directly. Keeping the culture inside a retrievable housing means
      nothing is released loose into the reservoir, and the housing comes back for assay.
    </div>

    ${pending ? `
    <div class="card card--pad">
      <div class="card__title"><h3>Ready for retrieval</h3><span>${pending} housing${pending === 1 ? '' : 's'}</span></div>
      <p style="margin:0 0 11px;font-size:11.5px;line-height:1.55;color:var(--ink-2)">
        A cartridge becomes recoverable once its lysis window closes and the payload is spent.
        Log it as retrieved when the housing is back on the service boat.
      </p>
      <button class="actionbtn actionbtn--solid" data-action="retrieve-all" style="width:100%">
        ${ic('ic-check')} Mark all ${pending} retrieved
      </button>
    </div>` : ''}

    <div class="sec-label sec-label--row"><span>Deployment history</span><span style="font-weight:650">${total} logged</span></div>

    <div class="timeline">
      ${state.cartridges.map(c => {
        const st = CART_STATE[c.state];
        return `<div class="tl-item">
          <span class="tl-dot" style="background:${st.color}">${ic(st.icon)}</span>
          <div class="tl-body">
            <div class="t">
              <b>${esc(c.id)} · ${esc(c.buoy)}</b>
              <time>${esc(c.deployed || c.loaded)}</time>
            </div>
            <div style="margin-top:5px"><span class="badge ${st.badge}">${st.label}</span></div>
            <p>${esc(c.note)}</p>
            <div class="tl-kv">
              <span>Dose <b>${c.dose} L</b></span>
              <span>Capacity <b>${c.capacity}%</b></span>
              ${c.kill != null ? `<span>Knockdown <b>${c.kill}%</b></span>` : ''}
              <span>Trigger <b>${esc(c.trigger)}</b></span>
              ${c.retrieved ? `<span>Retrieved <b>${esc(c.retrieved)}</b></span>` : ''}
            </div>
            ${c.state === 'spent' ? `<div class="alert__acts"><button class="minibtn minibtn--solid" data-action="retrieve" data-cart="${c.id}">Mark retrieved</button></div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="btnrow">
      <button class="actionbtn actionbtn--danger" data-action="deploy" ${onboard > 0 ? '' : 'disabled'}>
        ${ic('ic-cartridge')} Deploy now
      </button>
      <button class="actionbtn" data-goto="harvest">${ic('ic-leaf')} Harvest</button>
    </div>`;

  return shell(barPlain('Cartridge Log', 'home'), body, 'profile');
}

/* ============================================================
   SCREEN — HARVEST / BIOGAS
   ============================================================ */
function ScreenHarvest(){
  const b = buoy();
  const body = `
    <div class="page-head">
      <h2>Harvest<span class="thin">&amp; Biogas</span></h2>
      <p>Skimmer → onboard holding tank → shore anaerobic digester → methane back to the station.</p>
    </div>

    <div class="card card--pad">
      <div class="card__title"><h3>Onboard holding tank</h3><span>${b.tank}% full</span></div>
      <div class="prog ${b.tank > 75 ? 'prog--amber' : 'prog--leaf'}"><div class="prog__fill" style="width:${b.tank}%"></div></div>
      <div class="kv" style="margin-top:10px"><span>Skimmer throughput</span><b>4.8 kg/day</b></div>
      <div class="kv"><span>Mesh strain stage</span><b>Nominal</b></div>
      <div class="kv"><span>Return-to-shore trigger</span><b>90% full</b></div>
    </div>

    <div class="sec-label">Conversion chain</div>
    <div class="rows">
      ${[
        ['Skimmer sweep','Conveyor lifts surface mat into the funnel','ic-wave','#1B6CA8','40.5 kg'],
        ['Water strain','Mesh drains free water before storage','ic-drop','#3FB6D3','−62% mass'],
        ['Anaerobic digestion','Shore digester, ~65% methane fraction','ic-flask','#3FA34D','16.8 m³'],
        ['Energy return','Methane offsets station and buoy charging','ic-bolt','#F0A32E','102 kWh']
      ].map(([t, s, i, c, v]) => `
        <div class="row">
          <span class="row__ic" style="background:${c}">${ic(i)}</span>
          <span class="row__main"><b>${t}</b><small>${s}</small></span>
          <span class="row__end"><span class="big">${v}</span></span>
        </div>`).join('')}
    </div>

    <div class="note">
      Removal only runs when concentration exceeds the healthy ecological threshold, so the buoy
      never strips a basin that is functioning normally.
    </div>`;

  return shell(barPlain('Harvest & Biogas', 'home'), body, 'home');
}

/* ============================================================
   SCREEN — PROFILE
   ============================================================ */
function ScreenProfile(){
  const initials = state.user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const body = `
    <div class="prof">
      <div class="prof__av">${esc(initials)}</div>
      <div class="prof__id">
        <b>${esc(state.user.name)}</b>
        <small>${esc(state.user.email)}</small>
        <small>${esc(state.user.org)}</small>
      </div>
    </div>

    <div class="prof__stats">
      <div class="prof__stat"><b>${BB.FLEET.length}</b><small>Buoys</small></div>
      <div class="prof__stat"><b>${state.cartridges.filter(c => c.state !== 'loaded').length}</b><small>Deployments</small></div>
      <div class="prof__stat"><b>1,240</b><small>kg recovered</small></div>
    </div>

    <div class="sec-label">Shortcuts</div>
    <div class="rows">
      ${[
        ['Cartridge Log','Deployment history and retrieval','ic-cartridge','#3FA34D','cartridges'],
        ['Live Sensors','Real-time channels and risk score','ic-wave','#1B6CA8','sensors'],
        ['Harvest & Biogas','Recovery chain and energy return','ic-leaf','#2C7A3F','harvest'],
        ['Alert rules','Thresholds and push settings','ic-bell','#F0A32E','alerts']
      ].map(([t, s, i, c, go]) => `
        <button class="row" data-goto="${go}">
          <span class="row__ic" style="background:${c}">${ic(i)}</span>
          <span class="row__main"><b>${t}</b><small>${s}</small></span>
          ${ic('ic-chev','row__chev')}
        </button>`).join('')}
    </div>

    <div class="sec-label">Account</div>
    <div class="card card--pad">
      <div class="kv"><span>Organisation</span><b>${esc(state.user.org)}</b></div>
      <div class="kv"><span>Role</span><b>Operations lead</b></div>
      <div class="kv"><span>Fleet access</span><b>All ${BB.FLEET.length} buoys</b></div>
      <div class="kv"><span>App version</span><b>Freshwater Future 1.0</b></div>
    </div>

    <div class="btnrow" style="grid-template-columns:1fr">
      <button class="actionbtn" data-action="logout" style="color:#A81E1E">Sign out</button>
    </div>`;

  return shell(barPlain('Profile'), body, 'profile');
}

/* ============================================================
   ROUTER
   ============================================================ */
const SCREENS = {
  home:ScreenHome, sensors:ScreenSensors, analytics:ScreenAnalytics,
  alerts:ScreenAlerts, cartridges:ScreenCartridges,
  harvest:ScreenHarvest, profile:ScreenProfile
};
const TAB_ORDER = ['home','analytics','profile'];

function render(){
  if (!state.auth){
    screenEl.classList.add('sb-light');
    screenEl.classList.remove('sb-brand');
    app.innerHTML = ScreenLogin();
    return;
  }
  screenEl.classList.remove('sb-light');
  screenEl.classList.remove('sb-brand');
  app.innerHTML = (SCREENS[state.screen] || ScreenHome)();
  const v = $('#view'); if (v) v.scrollTop = 0;
  if (state.screen === 'home'){
    initMap(BB.FLEET.map(b => {
      const risk = riskOf(b.id);
      return { b, risk, band: BB.riskBand(risk) };
    }).sort((x, y) => y.risk - x.risk));
  }
}

function go(scr){
  if (!SCREENS[scr]) return;
  state.screen = scr;
  closeDrawer();
  if (!$('#sheet').hidden) $('#sheet').hidden = true;
  render();
}

/* ============================================================
   LIVE PATCHING  (no full re-render, so scroll + focus survive)
   ============================================================ */
function updateLive(){
  if (!state.auth) return;
  const risk = riskOf(), band = BB.riskBand(risk);

  $$('[data-live="risk-num"]').forEach(el => { el.textContent = risk; });
  const arc = $('[data-live="risk-arc"]');
  if (arc) arc.setAttribute('stroke-dashoffset', (245.04 * (1 - risk / 100)).toFixed(1));
  const chip = $('[data-live="risk-chip"]');
  if (chip){
    chip.className = 'riskchip ' + band.cls;
    chip.innerHTML = ic('ic-warn') + band.label + ' risk';
  }

  if (state.screen === 'sensors'){
    const hist = state.hist[state.buoyId];
    for (const key in BB.SENSORS){
      const arr = hist[key]; if (!arr) continue;
      const spec = BB.SENSORS[key];
      const v = arr[arr.length - 1];
      const valEl = $(`[data-live-val="${key}"]`);
      if (valEl) valEl.innerHTML = BB.fmt(key, v) + `<small>${spec.unit}</small>`;
      const spEl = $(`[data-live-spark="${key}"]`);
      if (spEl) spEl.innerHTML = sparkline(arr, spec.color, 120, 26);
      const prev = arr[Math.max(0, arr.length - 9)];
      const d = v - prev;
      const dir = Math.abs(d) < (spec.span[1] - spec.span[0]) * 0.004 ? 'flat' : (d > 0 ? 'up' : 'down');
      const dEl = $(`[data-live-delta="${key}"]`);
      if (dEl){
        dEl.className = 'tile__delta ' + dir;
        dEl.textContent = (dir === 'flat' ? '→' : dir === 'up' ? '↑' : '↓') + ' ' + Math.abs(d).toFixed(spec.dp) + ' over 2 h';
      }
      const out = BB.isOutOfBand(spec, v);
      const tileEl = $(`[data-tile="${key}"]`);
      if (tileEl) tileEl.classList.toggle('is-out', out);
      const flagEl = $(`[data-live-flag="${key}"]`);
      if (flagEl) flagEl.innerHTML = out ? '<span class="tile__flag">OUT OF BAND</span>' : '';
    }
    const dv = $('[data-live="drivers"]');
    if (dv) dv.innerHTML = driversHTML(BB.riskDrivers(readings()).slice(0, 5));
  }
}

/* ============================================================
   SIMULATION LOOP
   ============================================================ */
let timer = null;
function startSim(){
  if (timer) clearInterval(timer);
  timer = setInterval(tick, state.fast ? 700 : 1600);
}

function tick(){
  state.tickCount++;
  BB.FLEET.forEach(b => {
    const boost = state.boost[b.id] || 0;
    BB.tickHistory(b, state.hist[b.id], state.rnd[b.id], boost);
    /* 0.90 decay keeps a forcing event worth roughly a third of each
       channel's range — enough to move the score, not enough to peg it. */
    state.boost[b.id] = Math.abs(boost) < 0.02 ? 0 : boost * 0.90;
    const cd = state.cooldown[b.id];
    if (cd.risk > 0) cd.risk--;
    if (cd.do > 0) cd.do--;
    checkThresholds(b);
  });
  advanceCartridges();
  updateLive();
}

/* Fire on the *rising edge* of each rule, so a reading that sits above the
   line does not re-alert every tick. Each rule keeps its own cooldown —
   sharing one would let whichever rule trips first mute the other. */
function checkThresholds(b){
  const r    = readings(b.id);
  const risk = BB.riskScore(r);
  const cd   = state.cooldown[b.id];

  const wasAbove = state.aboveRisk[b.id];
  const isAbove  = risk >= state.thresholds.risk;
  state.aboveRisk[b.id] = isAbove;
  if (isAbove && wasAbove === false && cd.risk === 0){
    cd.risk = 45;
    raiseBloomAlert(b, risk);
  }

  const wasLow = state.lowDO[b.id];
  const isLow  = r.do < state.thresholds.doFloor;
  state.lowDO[b.id] = isLow;
  if (isLow && wasLow === false && cd.do === 0){
    cd.do = 70;
    addAlert({
      sev:'high', icon:'ic-drop', color:'#E8562A',
      title:`Dissolved oxygen below floor — ${b.name}`,
      body:`${b.id} reading ${r.do.toFixed(2)} mg/L, under the ${state.thresholds.doFloor.toFixed(1)} mg/L floor. Decaying biomass is drawing the column down.`,
      buoy:b.id, acts:[['View sensors','sensors']]
    });
  }
}

function raiseBloomAlert(b, risk){
  const r = readings(b.id);
  const empty = b.cartridges <= 0;
  const auto  = state.thresholds.autoDeploy && !empty;

  /* Three distinct outcomes — an empty bay is not the same thing as
     auto-deploy being switched off, and telling an operator to "approve"
     a release the buoy cannot physically make is worse than useless. */
  let outcome, short;
  if (empty){
    outcome = 'The cartridge bay is empty, so nothing can be released. This basin needs a resupply run before the buoy can intervene.';
    short   = 'Cartridge bay empty — resupply needed. ';
  } else if (auto){
    outcome = 'Auto-deploy is on — a cartridge has been released.';
    short   = 'Cartridge released automatically. ';
  } else {
    outcome = 'Auto-deploy is off, so this is waiting on your approval.';
    short   = 'Approval needed. ';
  }

  addAlert({
    sev: empty || risk >= 80 ? 'crit' : 'high', icon:'ic-warn', color: empty || risk >= 80 ? '#DE3B3B' : '#E8562A',
    title:`Bloom risk ${risk} — ${b.name}`,
    body:`Crossed your threshold of ${state.thresholds.risk}. Phycocyanin ${r.pc.toFixed(1)} µg/L, AVOC index ${r.voc.toFixed(1)} ppb, DO ${r.do.toFixed(2)} mg/L. ${outcome}`,
    buoy:b.id, acts:[['View sensors','sensors'],['Cartridge log','cartridges']]
  });
  pushNotify('Bloom risk ' + risk + ' — ' + b.name, short + 'Tap to open the live dashboard.', 'sensors');
  if (auto) doDeploy(b, true);
}

function refreshBadge(){
  const n = state.alerts.filter(x => x.unread).length;
  const bell = $('.appbar__bell');
  if (!bell) return;
  let badge = $('[data-badge]', bell);
  if (n && !badge) bell.insertAdjacentHTML('beforeend', `<span class="appbar__badge" data-badge>${n}</span>`);
  else if (n && badge) badge.textContent = n;
  else if (badge) badge.remove();
}

function addAlert(a){
  a.id = 'a' + Date.now() + Math.random().toString(36).slice(2, 5);
  a.mins = 0; a.unread = true;
  state.alerts.unshift(a);
  if (state.alerts.length > 24) state.alerts.pop();
  refreshBadge();
  if (state.screen === 'alerts') render();
}

/* ============================================================
   PUSH NOTIFICATION  (in-phone banner + real Web Notification)
   ============================================================ */
function pushNotify(title, body, goto){
  if (!state.thresholds.pushEnabled) return;
  const el = document.createElement('div');
  el.className = 'push';
  el.innerHTML = `
    <span class="push__app"><svg viewBox="0 0 120 120"><use href="#logo-mark"/></svg></span>
    <div>
      <div class="push__head"><b>Freshwater Future Tracker</b><time>now</time></div>
      <p>${esc(title)}<br><span style="color:var(--muted)">${esc(body)}</span></p>
    </div>`;
  if (goto) el.addEventListener('click', () => { go(goto); dismiss(el); });
  pushwrap.appendChild(el);
  const t = setTimeout(() => dismiss(el), 6500);
  function dismiss(node){
    clearTimeout(t);
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 320);
  }
  /* mirror to the OS if the user has granted permission */
  try {
    if ('Notification' in window && Notification.permission === 'granted'){
      new Notification('Freshwater Future Tracker — ' + title, { body: body, tag: 'freshwater-future' });
    }
  } catch (e) { /* notifications unavailable — the in-app banner still shows */ }
}

/* ============================================================
   ACTIONS
   ============================================================ */
function doDeploy(b, automatic){
  b = b || buoy();
  if (b.cartridges <= 0) return;
  b.cartridges--;
  const id = 'CT-' + (2300 + Math.floor(Math.random() * 90));
  const risk = riskOf(b.id);
  const chlNow = state.hist[b.id].chl[state.hist[b.id].chl.length - 1];
  state.cartridges.unshift({
    id, buoy:b.id, strain:'6A1', state:'deployed',
    loaded:'2026-08-04', deployed:stamp(), retrieved:null,
    dose:0.5, capacity:100,
    /* lysis window: ticks until the payload is spent and the housing
       can be recovered. chlAtDeploy is the baseline we measure against. */
    window:20, chlAtDeploy:chlNow,
    trigger:`Risk ${risk} → ${automatic ? 'auto-release' : 'operator approved'}`,
    kill:null,
    note:'Released over the highest-density patch. Lysis window opens in ~2 h; expect chlorophyll knockdown within 30 h.'
  });
  /* the intervention pulls the basin back down */
  state.boost[b.id] = -0.85;
  if (!automatic){
    pushNotify('Cartridge ' + id + ' released', b.name + ' — algicidal strain 6A1, 0.5 L dose. Knockdown expected within 30 h.', 'cartridges');
    addAlert({
      sev:'info', icon:'ic-cartridge', color:'#1B6CA8',
      title:`Cartridge ${id} deployed — ${b.name}`,
      body:`Operator-approved release at risk ${risk}. Housing stays tethered for retrieval and post-deployment assay.`,
      buoy:b.id, acts:[['Cartridge log','cartridges']]
    });
  }
  /* An emptied bay leaves the basin with no intervention available —
     surface it, whether the release was automatic or operator-approved. */
  if (b.cartridges === 0){
    addAlert({
      sev:'warn', icon:'ic-cartridge', color:'#F0A32E',
      title:`Cartridge bay empty — ${b.name}`,
      body:`${b.id} released its last cartridge (${id}). Until a resupply run, this basin can sense and predict but cannot intervene.`,
      buoy:b.id, acts:[['Cartridge log','cartridges'],['Map','home']]
    });
  }

  if (state.screen === 'cartridges' || state.screen === 'sensors') render();
}

/* Knockdown actually achieved, measured against the chlorophyll-a reading
   taken when the cartridge went out. Falls back for the seeded entries
   that were already in the water when the app started. */
function measureKnockdown(c){
  const hist = state.hist[c.buoy];
  if (!hist || !c.chlAtDeploy) return 70;
  const now = hist.chl[hist.chl.length - 1];
  const pct = Math.round((1 - now / c.chlAtDeploy) * 100);
  return Math.max(38, Math.min(92, pct));
}

/* Run the lysis window down on anything in the water. When it expires the
   payload is spent and the housing becomes recoverable — which is what
   puts the Retrieve action on screen. */
function advanceCartridges(){
  let changed = false;
  state.cartridges.forEach(c => {
    if (c.state !== 'deployed') return;
    if (c.window == null) c.window = 20;
    c.window--;
    if (c.window > 0) return;

    c.state    = 'spent';
    c.capacity = 0;
    c.kill     = measureKnockdown(c);
    changed    = true;
    addAlert({
      sev:'ok', icon:'ic-check', color:'#3FA34D',
      title:`Knockdown confirmed — ${c.buoy}`,
      body:`${c.id} finished its lysis window with chlorophyll-a down ${c.kill}%. The housing is spent and ready for retrieval on the next service run.`,
      buoy:c.buoy, acts:[['Retrieve it','cartridges']]
    });
  });
  if (changed && state.screen === 'cartridges') render();
}

/* Retrieval recovers an *empty* housing — it does NOT rearm the buoy. The
   housing still has to go ashore and be re-cultured before it counts as a
   live cartridge again, so the on-board count is deliberately untouched. */
function retrieveCartridge(c){
  if (c.state !== 'spent') return;
  c.state     = 'retrieved';
  c.retrieved = stamp();
  c.note      = 'Empty housing recovered on the service run. Post-deployment assay logged; seals cleared for re-culturing on shore.';
}

function stamp(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `2026-08-06 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function cycleBuoy(){
  const i = BB.FLEET.findIndex(b => b.id === state.buoyId);
  state.buoyId = BB.FLEET[(i + 1) % BB.FLEET.length].id;
  render();
}

/* ============================================================
   BUOY DETAIL SHEET  (tap a map marker)
   ============================================================ */
function openSheet(id){
  const b = buoy(id);
  if (!b) return;
  const r = readings(id), risk = riskOf(id), band = BB.riskBand(risk);
  const loaded = state.cartridges.filter(c => c.buoy === id && c.state === 'loaded').length;
  const pending = state.cartridges.filter(c => c.buoy === id && c.state === 'spent').length;

  $('#sheetPanel').innerHTML = `
    <div class="sheet__grab"></div>
    <button class="sheet__x" data-action="close-sheet" aria-label="Close">&times;</button>

    <div class="sheet__head">
      <span class="sheet__ic" style="background:${band.color}">${ic('ic-wave')}</span>
      <div class="sheet__id">
        <b>${esc(b.name)}</b>
        <small>${esc(b.id)} · ${esc(b.water)}</small>
      </div>
      <div class="sheet__risk">
        <span style="color:${band.color}">${risk}</span>
        <small>${band.label}</small>
      </div>
    </div>

    <div class="sheet__coord">${ic('ic-pin')}${BB.coord(b.lat, b.lon)}</div>

    <div class="sheet__grid">
      <div><b>${BB.fmt('ph', r.ph)}</b><small>pH</small></div>
      <div><b>${BB.fmt('do', r.do)}</b><small>DO mg/L</small></div>
      <div><b>${BB.fmt('voc', r.voc)}</b><small>AVOC ppb</small></div>
      <div><b>${b.battery}%</b><small>Battery</small></div>
      <div><b>${b.cartridges}</b><small>Cartridges</small></div>
      <div><b>${b.tank}%</b><small>Tank</small></div>
    </div>

    <div class="sheet__meta">
      <span>Operator <b>${esc(b.org)}</b></span>
      <span>Deployed <b>${esc(b.deployed)}</b></span>
      ${pending ? `<span>Awaiting retrieval <b>${pending}</b></span>` : ''}
      ${loaded ? `<span>Ready to load <b>${loaded}</b></span>` : ''}
    </div>

    <div class="sheet__acts">
      <button class="actionbtn actionbtn--solid" data-action="sheet-open-buoy" data-buoy-id="${b.id}">
        ${ic('ic-wave')} Live dashboard
      </button>
      <button class="actionbtn" data-action="close-sheet">Back to map</button>
    </div>`;

  $('#sheet').hidden = false;
  state.map.selected = id;
  applyMapView(true);
}

function closeSheet(){
  const s = $('#sheet');
  if (s.hidden) return;
  const panel = $('#sheetPanel');
  panel.classList.add('is-out');
  setTimeout(() => { panel.classList.remove('is-out'); s.hidden = true; }, 220);
  state.map.selected = null;
  applyMapView(true);
}

function openDrawer(){
  $('#drawerUser').textContent = state.user.name;
  $('#drawerOrg').textContent  = state.user.org;
  drawer.hidden = false;
}
function closeDrawer(){ drawer.hidden = true; }

function login(){
  const email = ($('#fEmail') || {}).value || '';
  const pass  = ($('#fPass')  || {}).value || '';
  const err   = $('#loginErr');
  if (!email.trim() || !pass.trim()){
    if (err) err.textContent = 'Enter an email or phone and a password to continue.';
    return;
  }
  state.user.email = email.trim();
  state.user.name  = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Field Ops';
  state.auth = true;
  state.screen = 'home';
  render();
  /* ask once, politely, so the threshold alert can reach the OS */
  try {
    if ('Notification' in window && Notification.permission === 'default'){
      Notification.requestPermission().catch(() => {});
    }
  } catch (e) {}
  setTimeout(() => {
    pushNotify('Connected to ' + buoy().name,
      'BG-014 streaming 9 channels. Bloom risk ' + riskOf() + ' and rising — watching your threshold of ' + state.thresholds.risk + '.', 'sensors');
  }, 1400);
}

function logout(){
  state.auth = false;
  closeDrawer();
  pushwrap.innerHTML = '';
  render();
}

/* ============================================================
   EVENTS
   ============================================================ */
document.addEventListener('click', e => {
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;

  const goEl = t.closest('[data-goto]');
  if (goEl){
    const soft = goEl.getAttribute('data-buoy-soft');
    if (soft && BB.FLEET.some(b => b.id === soft)) state.buoyId = soft;
    go(goEl.getAttribute('data-goto'));
    return;
  }

  /* map marker -> detail sheet (does not navigate) */
  const pinEl = t.closest('[data-pin]');
  if (pinEl){
    const svg = $('#wmSvg');
    if (svg && svg.dataset.dragged) return;   /* was a pan, not a tap */
    openSheet(pinEl.getAttribute('data-pin'));
    return;
  }

  const buoyEl = t.closest('[data-buoy]');
  if (buoyEl){
    state.buoyId = buoyEl.getAttribute('data-buoy');
    go('sensors');
    return;
  }

  const rangeEl = t.closest('[data-range]');
  if (rangeEl){ state.range = rangeEl.getAttribute('data-range'); render(); return; }

  const tglEl = t.closest('[data-toggle]');
  if (tglEl){
    const k = tglEl.getAttribute('data-toggle');
    state.thresholds[k] = !state.thresholds[k];
    tglEl.classList.toggle('is-on', state.thresholds[k]);
    if (k === 'pushEnabled' && state.thresholds[k]){
      try {
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      } catch (err) {}
    }
    return;
  }

  const actEl = t.closest('[data-action]');
  if (!actEl) return;
  const act = actEl.getAttribute('data-action');

  switch (act){
    case 'login':        login(); break;
    case 'logout':       logout(); break;
    case 'open-drawer':  openDrawer(); break;
    case 'close-drawer': closeDrawer(); break;
    case 'close-sheet':  closeSheet(); break;
    case 'sheet-open-buoy':
      state.buoyId = actEl.getAttribute('data-buoy-id');
      closeSheet();
      go('sensors');
      break;
    case 'cycle-buoy':   cycleBuoy(); break;
    case 'refresh':      render(); break;
    case 'zoom-in':      zoomBy(1.6); break;
    case 'zoom-out':     zoomBy(1 / 1.6); break;
    case 'zoom-next':    jumpToBuoy(); break;
    case 'deploy':       doDeploy(buoy(), false); break;
    case 'simulate':
      state.boost[state.buoyId] = 1.5;
      state.cooldown[state.buoyId] = { risk:0, do:0 };
      pushNotify('Bloom event simulated', buoy().name + ' — forcing nutrient and biomass channels upward. Watch the risk score climb.', null);
      break;
    case 'test-push':
      pushNotify('Test alert', 'Rules are live. You would get this the moment risk crosses ' + state.thresholds.risk + '.', 'sensors');
      break;
    case 'read':{
      const id = actEl.getAttribute('data-alert');
      const a = state.alerts.find(x => x.id === id);
      if (a) a.unread = false;
      render();
      break;
    }
    case 'read-all':
      state.alerts.forEach(a => { a.unread = false; });
      render();
      break;
    case 'retrieve':{
      const id = actEl.getAttribute('data-cart');
      const c = state.cartridges.find(x => x.id === id);
      if (c) retrieveCartridge(c);
      render();
      break;
    }
    case 'retrieve-all':{
      const spent = state.cartridges.filter(x => x.state === 'spent');
      spent.forEach(retrieveCartridge);
      if (spent.length){
        pushNotify(`${spent.length} housing${spent.length === 1 ? '' : 's'} retrieved`,
          'Logged against their deployments. Seals cleared for reuse after assay.', 'cartridges');
      }
      render();
      break;
    }
  }
});

/* range sliders */
document.addEventListener('input', e => {
  if (!e.target || typeof e.target.closest !== 'function') return;
  const el = e.target.closest('[data-th]');
  if (!el) return;
  const k = el.getAttribute('data-th');
  state.thresholds[k] = parseFloat(el.value);
  if (k === 'risk'){ const o = $('#thRiskVal'); if (o) o.textContent = state.thresholds.risk; }
  if (k === 'doFloor'){ const o = $('#thDoVal'); if (o) o.textContent = state.thresholds.doFloor.toFixed(1) + ' mg/L'; }
});

/* enter-to-login */
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !state.auth){ e.preventDefault(); login(); return; }
  if (!state.auth) return;
  /* the event target is not always an Element (document, window) */
  const tgt = e.target;
  if (tgt && typeof tgt.matches === 'function' && tgt.matches('input')) return;

  if (e.key === 'Escape'){ closeSheet(); closeDrawer(); return; }
  /* keyboard activation for map markers */
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-pin]')){
    e.preventDefault();
    openSheet(e.target.closest('[data-pin]').getAttribute('data-pin'));
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
    const cur = TAB_ORDER.indexOf(state.screen);
    const base = cur === -1 ? 0 : cur;
    const next = (base + (e.key === 'ArrowRight' ? 1 : TAB_ORDER.length - 1)) % TAB_ORDER.length;
    go(TAB_ORDER[next]);
  }
  if (e.key.toLowerCase() === 'd'){
    state.fast = !state.fast;
    startSim();
    pushNotify(state.fast ? 'Demo speed: fast' : 'Demo speed: normal',
      state.fast ? 'Sampling every 0.7 s so trends move on stage.' : 'Back to a 1.6 s sample interval.', null);
  }
});

/* aside shortcuts on the desktop stage */
$$('[data-goto]', $('.stage__aside')).forEach(el => {
  el.addEventListener('click', () => { if (state.auth) go(el.getAttribute('data-goto')); });
});

/* ============================================================
   CLOCK + BOOT
   ============================================================ */
function clock(){
  const d = new Date();
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  h = h % 12 || 12;
  $('#clock').textContent = h + ':' + m;
}
clock(); setInterval(clock, 10000);

render();
startSim();

})();
