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
  tickCount:0
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
    mins:96, buoy:'BG-033', unread:true, acts:[['Open buoy','fleet']] },
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
  const unread = state.alerts.filter(a => a.unread).length;
  const tabs = [
    ['home','ic-home'], ['analytics','ic-chart'], ['fleet','ic-pin'],
    ['alerts','ic-bell'], ['profile','ic-user']
  ];
  return `<nav class="tabbar">${tabs.map(([k, i]) => `
    <button class="tab ${active === k ? 'is-on' : ''}" data-goto="${k}" aria-label="${k}">
      ${ic(i)}${k === 'alerts' && unread ? `<span class="tab__badge">${unread}</span>` : ''}
    </button>`).join('')}</nav>`;
}

function shell(bar, body, active, flush){
  return bar + `<div class="view ${flush ? 'view--flush' : ''}" id="view">${body}</div>` + tabbar(active);
}

function barBrand(){
  const b = buoy();
  return `<header class="appbar appbar--brand">
    <svg class="appbar__logo" viewBox="0 0 120 120"><use href="#logo-mark"/></svg>
    <button class="appbar__loc" data-action="cycle-buoy" title="Switch buoy">
      ${ic('ic-pin')}<span>${BB.coord(b.lat, b.lon)}</span>${ic('ic-chev','chev')}
    </button>
    <button class="appbar__btn" data-action="open-drawer" aria-label="Menu">${ic('ic-menu')}</button>
  </header>`;
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
   SCREEN — HOME
   ============================================================ */
function ScreenHome(){
  const b = buoy(), r = readings(), risk = riskOf(), band = BB.riskBand(risk);
  const cart = state.cartridges.filter(c => c.buoy === b.id && c.state === 'loaded').length + b.cartridges;
  const tankPct = b.tank;

  const body = `
    <div class="hero">
      <div class="hero__sky"></div><div class="hero__sun"></div>
      <svg class="hero__buoy" width="86" height="86" viewBox="0 0 86 86" aria-hidden="true">
        <ellipse cx="43" cy="62" rx="30" ry="6" fill="rgba(6,42,69,.18)"/>
        <rect x="22" y="16" width="42" height="10" rx="2.5" fill="#1B3A52"/>
        <rect x="24" y="18" width="38" height="6" rx="1.5" fill="#2E5F86"/>
        <rect x="41" y="26" width="4" height="16" fill="#8A98A4"/>
        <circle cx="43" cy="14" r="3.4" fill="#7CE08A"/>
        <path d="M24 44h38l-5 16H29z" fill="#E8562A"/>
        <path d="M24 44h38l-1.6 5H25.6z" fill="#F0A32E"/>
        <rect x="40" y="60" width="6" height="12" rx="2" fill="#B9C6D0"/>
        <path d="M4 66c8-5 14 5 22 0s14 5 22 0 14 5 22 0 12 3 16 1" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.4" stroke-linecap="round"/>
      </svg>
      <div class="hero__glare"></div>
      <div class="hero__meta">
        <span class="hero__badge"><span class="livedot"></span>Streaming · ${b.id}</span>
        <span class="hero__badge">${esc(b.name)}</span>
      </div>
    </div>

    <div class="devrow">
      <span class="devrow__ic">${ic('ic-wave')}</span>
      <span>Freshwater Future 1.0</span>
      <span class="devrow__status"><span class="livedot"></span>Online</span>
    </div>

    <!-- bloom risk card -->
    <button class="feed" data-goto="sensors">
      <div class="feed__thumb" style="display:grid;place-items:center;background:linear-gradient(150deg,#0B3C5D,#2E8FC0)">
        <div style="text-align:center;color:#fff">
          <div style="font-size:30px;font-weight:800;letter-spacing:-1.4px;line-height:1" data-live="risk-num">${risk}</div>
          <div style="font-size:8px;font-weight:750;letter-spacing:.13em;opacity:.8;margin-top:3px">BLOOM RISK</div>
        </div>
      </div>
      <div class="feed__body">
        <h4>Risk is ${band.label.toLowerCase()}</h4>
        <p>The model is reading pH ${BB.fmt('ph', r.ph)}, DO ${BB.fmt('do', r.do)} mg/L and an AVOC index of ${BB.fmt('voc', r.voc)} ppb across the last 12 hours.</p>
        <span class="feed__cta">Open live dashboard ${ic('ic-chev')}</span>
      </div>
    </button>

    <!-- cartridge card -->
    <button class="feed" data-goto="cartridges">
      <div class="feed__thumb" style="background:linear-gradient(150deg,#E6F6EA,#CDEAF3);display:grid;place-items:center">
        <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
          <rect x="15" y="4" width="16" height="6" rx="2" fill="#2C7A3F"/>
          <rect x="12" y="10" width="22" height="30" rx="5" fill="#fff" stroke="#3FA34D" stroke-width="2"/>
          <rect x="16" y="24" width="14" height="12" rx="3" fill="#3FA34D" opacity=".85"/>
          <rect x="16" y="15" width="14" height="6" rx="2" fill="#CDEAF3"/>
        </svg>
      </div>
      <div class="feed__body">
        <h4>Half Done!</h4>
        <p>Your buoy has successfully dispensed half of the algicide in its tank.</p>
        <div style="margin-top:6px"><div class="prog prog--leaf"><div class="prog__fill" style="width:52%"></div></div></div>
        <span class="feed__chip">${cart} cartridges on board</span>
        <span class="feed__cta">Check the Data! ${ic('ic-chev')}</span>
      </div>
    </button>

    <!-- fleet card -->
    <button class="feed" data-goto="fleet">
      <div class="feed__thumb" style="background:#E4F1FA">
        <svg viewBox="0 0 104 90" style="width:100%;height:100%" aria-hidden="true">
          <path d="M0 60c14-14 26 6 40-6s28 10 40-4 24 2 24 2" fill="none" stroke="#B8DCEA" stroke-width="2"/>
          <path d="M0 34c12-10 24 8 36-2s26 8 36-4 22 4 32 2" fill="none" stroke="#CDEAF3" stroke-width="2"/>
          <circle cx="24" cy="30" r="7" fill="#1B6CA8" opacity=".18"/>
          <circle cx="24" cy="30" r="3.4" fill="#1B6CA8"/>
          <circle cx="66" cy="56" r="7" fill="#E8562A" opacity=".18"/>
          <circle cx="66" cy="56" r="3.4" fill="#E8562A"/>
          <circle cx="86" cy="24" r="3.4" fill="#3FA34D"/>
          <path d="M24 30 66 56 86 24" fill="none" stroke="#7FD8E8" stroke-width="1.4" stroke-dasharray="3 3"/>
        </svg>
      </div>
      <div class="feed__body">
        <h4>Make Friends!</h4>
        <p>Check out other Freshwater Future buoys in your fleet. Compare basins and share intervention outcomes.</p>
        <span class="feed__chip">${BB.FLEET.length} buoys · ${new Set(BB.FLEET.map(f => f.org)).size} operators</span>
        <span class="feed__cta">Search ${ic('ic-search')}</span>
      </div>
    </button>

    <!-- tank -->
    <div class="card card--pad">
      <div class="card__title"><h3>Holding tank</h3><span>${tankPct}% full</span></div>
      <div class="prog ${tankPct > 75 ? 'prog--amber' : ''}"><div class="prog__fill" style="width:${tankPct}%"></div></div>
      <div class="kv" style="margin-top:9px"><span>Skimmed this week</span><b>40.5 kg</b></div>
      <div class="kv"><span>Next digester run</span><b>in 2 days</b></div>
    </div>

    <div class="dotsrow"><i class="on"></i><i></i><i></i><i></i></div>
    <div class="seemore"><span></span><span>See More ${'›'}</span></div>
    <div class="feed-end">No more Information</div>`;

  return shell(barBrand(), body, 'home');
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
   SCREEN — ANALYTICS
   ============================================================ */
function ScreenAnalytics(){
  const s = BB.SUMMARY[state.range];
  const pct = Math.round(s.collected / s.target * 100);

  const body = `
    <div class="segs">
      ${['daily','weekly','monthly','yearly'].map(k => `
        <button class="seg ${state.range === k ? 'is-on' : ''}" data-range="${k}">
          ${k[0].toUpperCase() + k.slice(1)}
        </button>`).join('')}
    </div>

    <div class="page-head">
      <h2>${s.title[0]}<span class="thin">${s.title[1]}</span></h2>
    </div>

    <div class="chartbox">${barChart(s.bars, s.max)}</div>

    <div class="bigstat">
      <div class="bigstat__label">${s.cLabel}</div>
      <div class="bigstat__row">
        <span class="bigstat__num">${s.collected}</span>
        <span class="bigstat__unit">${s.cUnit} out of ${s.target}</span>
      </div>
      <div class="prog prog--leaf" style="margin-top:9px"><div class="prog__fill" style="width:${pct}%"></div></div>
    </div>

    <div class="legend">
      ${s.series.map(x => {
        const lo = Math.min.apply(null, x.pts), hi = Math.max.apply(null, x.pts);
        return `<span><i style="background:${x.color}"></i>${esc(x.name)}
                  <em style="font-style:normal;color:var(--muted)">${lo}–${hi} ${esc(x.unit)}</em></span>`;
      }).join('')}
    </div>
    <div class="legend" style="padding-top:0;font-size:10px;color:var(--muted);font-weight:600">
      Each line is scaled to its own range so both channels stay readable.
    </div>
    <div class="chartbox">${lineChart(s.series, s.xl)}</div>

    <div class="card card--pad">
      <div class="card__title"><h3>Period stats</h3><span>${esc(buoy().name)}</span></div>
      ${s.kpis.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
    </div>

    <div class="card card--pad">
      <div class="card__title"><h3>Resource recovery</h3><span>shore digester</span></div>
      <div class="kv"><span>Biogas produced</span><b>${s.bars[2].v} m³</b></div>
      <div class="kv"><span>Methane fraction</span><b>≈ 65%</b></div>
      <div class="kv"><span>Energy returned to buoy</span><b>${(s.bars[2].v * 6.1).toFixed(0)} kWh<sub>e</sub></b></div>
      <div class="note" style="margin:11px 0 0">
        Skimmed biomass goes to anaerobic digestion on shore. The recovered methane offsets
        the station load, so the intervention pays part of its own running cost.
      </div>
    </div>`;

  return shell(barPlain('Analytics'), body, 'analytics');
}

/* ============================================================
   SCREEN — FLEET  (world map)
   ------------------------------------------------------------
   Equirectangular world map. Coastlines and buoy markers share one
   projection (BB.projX / BB.projY) so every pin sits at its true
   lat/lon. Working in degree units keeps that verifiable: a marker
   at x=96.8 IS longitude -83.2.

   Ohio, New York and Kansas fall within a few degrees of each other,
   so at phone width their markers would sit on top of one another.
   A relaxation pass nudges overlapping markers apart and draws a
   leader line back to the true position — the anchor dot stays
   accurate, only the label-bearing marker moves.
   ============================================================ */
const MAP_VB = { x:6, y:6, w:354, h:148 };   /* lon -174..180, lat 84..-64 */
const PIN_MIN_SEP = 11;                       /* degrees between markers */

function layoutPins(rows){
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
        if (d < 0.001){ dx = 0.6; dy = 0.4; d = 0.72; }   /* exact overlap: break the tie */
        if (d < PIN_MIN_SEP){
          const push = (PIN_MIN_SEP - d) / 2 * 0.8;
          dx /= d; dy /= d;
          a.mx -= dx * push; a.my -= dy * push;
          c.mx += dx * push; c.my += dy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  /* keep markers inside the visible frame */
  pins.forEach(p => {
    p.mx = Math.max(MAP_VB.x + 7, Math.min(MAP_VB.x + MAP_VB.w - 7, p.mx));
    p.my = Math.max(MAP_VB.y + 7, Math.min(MAP_VB.y + MAP_VB.h - 7, p.my));
  });
  return pins;
}

function worldMap(rows){
  const land = BB.LANDMASSES.map(ring =>
    `<path d="${ring.map((p, i) => (i ? 'L' : 'M') + BB.projX(p[0]).toFixed(1) + ' ' + BB.projY(p[1]).toFixed(1)).join(' ')}Z"/>`
  ).join('');

  let grat = '';
  for (let lon = -150; lon <= 150; lon += 30){
    grat += `<line x1="${BB.projX(lon)}" y1="0" x2="${BB.projX(lon)}" y2="180"/>`;
  }
  for (let lat = -60; lat <= 60; lat += 30){
    grat += `<line x1="0" y1="${BB.projY(lat)}" x2="360" y2="${BB.projY(lat)}"/>`;
  }

  const pins = layoutPins(rows).map(p => {
    const off = Math.sqrt((p.mx - p.x) ** 2 + (p.my - p.y) ** 2) > 1.5;
    const hot = p.band.key === 'crit' || p.band.key === 'high';
    return `<g class="wm-pin" data-pin="${p.id}" role="button" tabindex="0"
               aria-label="${esc(p.name)}, bloom risk ${p.risk}">
      <title>${esc(p.name)} — risk ${p.risk}</title>
      ${off ? `<line class="wm-lead" x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}"
                     x2="${p.mx.toFixed(1)}" y2="${p.my.toFixed(1)}" stroke="${p.band.color}"/>
               <circle class="wm-anchor" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.3" fill="${p.band.color}"/>` : ''}
      ${hot ? `<circle class="wm-ping" cx="${p.mx.toFixed(1)}" cy="${p.my.toFixed(1)}" r="4.5" fill="${p.band.color}"/>` : ''}
      <circle class="wm-halo" cx="${p.mx.toFixed(1)}" cy="${p.my.toFixed(1)}" r="6" fill="#fff"/>
      <circle cx="${p.mx.toFixed(1)}" cy="${p.my.toFixed(1)}" r="4.3" fill="${p.band.color}"/>
      <circle cx="${p.mx.toFixed(1)}" cy="${p.my.toFixed(1)}" r="1.6" fill="#fff"/>
      <circle cx="${p.mx.toFixed(1)}" cy="${p.my.toFixed(1)}" r="10" fill="transparent"/>
    </g>`;
  }).join('');

  return `<div class="worldmap">
    <svg viewBox="${MAP_VB.x} ${MAP_VB.y} ${MAP_VB.w} ${MAP_VB.h}" role="img"
         aria-label="World map of ${rows.length} monitoring buoys">
      <rect x="0" y="0" width="360" height="180" fill="#CFE4EF"/>
      <g class="wm-grat">${grat}</g>
      <line class="wm-eq" x1="0" y1="90" x2="360" y2="90"/>
      <g class="wm-land">${land}</g>
      ${pins}
    </svg>
  </div>
  <p class="worldmap__hint">Tap a marker for buoy details · markers offset where basins overlap</p>`;
}

/* ============================================================
   SCREEN — FLEET
   ============================================================ */
function ScreenFleet(){
  const rows = BB.FLEET.map(b => {
    const risk = riskOf(b.id), band = BB.riskBand(risk);
    return { b, risk, band };
  }).sort((x, y) => y.risk - x.risk);

  const body = `
    <div class="page-head">
      <h2>Fleet<span class="thin">View</span></h2>
      <p>${BB.FLEET.length} buoys across ${new Set(BB.FLEET.map(f => f.org)).size} operators. Sorted by bloom risk.</p>
    </div>

    ${worldMap(rows)}
    <div class="risk-key">
      <span><i style="background:#3FA34D"></i>Low</span>
      <span><i style="background:#F0A32E"></i>Elevated</span>
      <span><i style="background:#E8562A"></i>High</span>
      <span><i style="background:#DE3B3B"></i>Critical</span>
    </div>

    <div class="sec-label sec-label--row"><span>All buoys</span><a data-action="refresh">Refresh</a></div>
    <div class="rows">
      ${rows.map(({ b, risk, band }) => `
        <button class="row" data-buoy="${b.id}">
          <span class="row__ic" style="background:${band.color}">${ic('ic-wave')}</span>
          <span class="row__main">
            <b>${esc(b.name)}${b.id === state.buoyId ? ' <span class="badge b-blue">Current</span>' : ''}</b>
            <small>${esc(b.id)} · ${esc(b.water)}<br>${esc(b.org)} · ${b.battery}% batt · ${b.cartridges} cartridge${b.cartridges === 1 ? '' : 's'}</small>
          </span>
          <span class="row__end">
            <span class="big" style="color:${band.color}">${risk}</span>
            <span class="badge ${band.key === 'low' ? 'b-green' : band.key === 'mod' ? 'b-amber' : 'b-red'}">${band.label}</span>
          </span>
        </button>`).join('')}
    </div>

    <div class="card card--pad">
      <div class="card__title"><h3>Fleet totals</h3><span>this season</span></div>
      <div class="kv"><span>Buoys reporting</span><b>${BB.FLEET.length} / ${BB.FLEET.length}</b></div>
      <div class="kv"><span>Cartridges deployed</span><b>${state.cartridges.filter(c => c.state !== 'loaded').length}</b></div>
      <div class="kv"><span>Algae recovered</span><b>1,240 kg</b></div>
      <div class="kv"><span>Basins above threshold</span><b>${rows.filter(r => r.risk >= state.thresholds.risk).length}</b></div>
    </div>`;

  return shell(barPlain('Fleet View'), body, 'fleet');
}

/* ============================================================
   SCREEN — ALERTS
   ============================================================ */
function ScreenAlerts(){
  const body = `
    <div class="page-head">
      <h2>Alerts<span class="thin">&amp; Thresholds</span></h2>
      <p>${state.alerts.filter(a => a.unread).length} unread · pushed the moment the model crosses your line, not when the bloom shows up.</p>
    </div>

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
  fleet:ScreenFleet, alerts:ScreenAlerts, cartridges:ScreenCartridges,
  harvest:ScreenHarvest, profile:ScreenProfile
};
const TAB_ORDER = ['home','analytics','fleet','alerts','profile'];

function render(){
  if (!state.auth){
    screenEl.classList.add('sb-light');
    screenEl.classList.remove('sb-brand');
    app.innerHTML = ScreenLogin();
    return;
  }
  screenEl.classList.remove('sb-light');
  screenEl.classList.toggle('sb-brand', state.screen === 'home');
  app.innerHTML = (SCREENS[state.screen] || ScreenHome)();
  const v = $('#view'); if (v) v.scrollTop = 0;
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

function addAlert(a){
  a.id = 'a' + Date.now() + Math.random().toString(36).slice(2, 5);
  a.mins = 0; a.unread = true;
  state.alerts.unshift(a);
  if (state.alerts.length > 24) state.alerts.pop();
  const badgeHost = $('.tabbar');
  if (badgeHost && state.screen !== 'alerts'){
    const n = state.alerts.filter(x => x.unread).length;
    let badge = $('.tab__badge', badgeHost);
    if (!badge){
      const tabEl = $$('.tab', badgeHost)[3];
      if (tabEl) tabEl.insertAdjacentHTML('beforeend', `<span class="tab__badge">${n}</span>`);
    } else badge.textContent = n;
  }
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
      buoy:b.id, acts:[['Cartridge log','cartridges'],['Fleet view','fleet']]
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
}

function closeSheet(){
  const s = $('#sheet');
  if (s.hidden) return;
  const panel = $('#sheetPanel');
  panel.classList.add('is-out');
  setTimeout(() => { panel.classList.remove('is-out'); s.hidden = true; }, 220);
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
  if (pinEl){ openSheet(pinEl.getAttribute('data-pin')); return; }

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
