/* ============================================================
   Freshwater Future Tracker — domain data + sensor simulation
   ------------------------------------------------------------
   Everything here models the BloomGuard buoy described in the
   Freshwater Futures brainstorm:
     · sensor suite  : pH, DO, temp, turbidity, nitrate, phosphate,
                       chlorophyll-a / phycocyanin fluorometer, AVOCs
     · prediction    : gradient-boosted bloom-risk score (0-100)
     · intervention  : nanobubble aeration — microbubbles collapse,
                       lysing the cyanobacteria and reoxygenating the
                       column. Nothing is skimmed or carried away; the
                       biomass remineralises in place.
   ============================================================ */

const BB = {};

/* ---------------------------------------------------------------
   1. SENSOR SPECS
   Ranges are the healthy operating band for a temperate freshwater
   reservoir; `risk` describes which direction pushes bloom risk up.
   --------------------------------------------------------------- */
BB.SENSORS = {
  ph:          { key:'ph',          name:'pH',            unit:'',        dp:2, good:[6.5, 9.0],  span:[6.0, 9.6],  risk:'high', color:'#7A5AD1', icon:'ic-flask' },
  do:          { key:'do',          name:'Dissolved O₂',  unit:'mg/L',    dp:2, good:[5.0, 12.0], span:[1.5, 13.0], risk:'low',  color:'#1B6CA8', icon:'ic-drop'  },
  voc:         { key:'voc',         name:'AVOC index',    unit:'ppb',     dp:1, good:[0, 30],     span:[2.5, 90],   risk:'high', color:'#E8562A', icon:'ic-bolt'  },
  temp:        { key:'temp',        name:'Water temp',    unit:'°C',      dp:1, good:[4, 26],     span:[2, 32],     risk:'high', color:'#F0A32E', icon:'ic-sun'   },
  chl:         { key:'chl',         name:'Chlorophyll-a', unit:'µg/L',    dp:1, good:[0, 40],     span:[1.2, 110],  risk:'high', color:'#3FA34D', icon:'ic-leaf'  },
  pc:          { key:'pc',          name:'Phycocyanin',   unit:'µg/L',    dp:1, good:[0, 20],     span:[0.3, 70],   risk:'high', color:'#2AA69A', icon:'ic-wave'  },
  turbidity:   { key:'turbidity',   name:'Turbidity',     unit:'NTU',     dp:1, good:[0, 25],     span:[1.0, 60],   risk:'high', color:'#8C6E4F', icon:'ic-wave'  },
  nitrate:     { key:'nitrate',     name:'Nitrate',       unit:'mg/L',    dp:2, good:[0, 3.0],    span:[0.08, 8],   risk:'high', color:'#3FB6D3', icon:'ic-flask' },
  phosphate:   { key:'phosphate',   name:'Phosphate',     unit:'mg/L',    dp:3, good:[0, 0.10],   span:[0.005, 0.42], risk:'high', color:'#C2477A', icon:'ic-flask' }
};

/* Weights for the bloom-risk model. Chlorophyll + phycocyanin are the
   direct biomass signals; AVOCs are the *early* signal (they shift
   before the bloom is visible), so they carry real weight too. */
BB.RISK_WEIGHTS = {
  pc:0.22, chl:0.20, voc:0.18, phosphate:0.12,
  nitrate:0.09, temp:0.09, do:0.06, ph:0.04
};

/* ---------------------------------------------------------------
   2. FLEET
   --------------------------------------------------------------- */
/* Nanobubble generator specs, shared by every buoy.
   The generator is solar-powered, so treatment capacity is bounded by
   runtime available from battery + charge, not by a consumable. */
BB.NB_RUNTIME_CAP = 12;      /* hours of continuous aeration on a full charge */
BB.NB_FLOW = 420;            /* m3 of water treated per hour of aeration */
BB.NB_O2_RATE = 1.8;         /* kg of O2 dispersed per hour */
BB.DO_FLOOR = 5.0;           /* mg/L — below this a basin is heading for hypoxia */

BB.FLEET = [
  {
    id:'BG-014', name:'Maumee Bay', water:'Lake Erie — Western Basin',
    lat:41.6870, lon:-83.2341, org:'Toledo Water Authority',
    x:30, y:34, deployed:'2026-04-11', battery:87, solar:23.4,
    nbState:'active', runtime:7.4, diffuser:88, treatedToday:3110, seed:{ ph:8.35, do:6.4, voc:26.5, temp:24.6, chl:31, pc:14.5, turbidity:19, nitrate:2.4, phosphate:0.098 },
    trend:'rising', depth:3.2
  },
  {
    id:'BG-021', name:'Grand Lake St. Marys', water:'Mercer County, OH',
    lat:40.5395, lon:-84.4977, org:'Ohio EPA',
    x:58, y:52, deployed:'2026-03-28', battery:74, solar:19.1,
    nbState:'idle', runtime:3.1, diffuser:94, treatedToday:1300, seed:{ ph:8.05, do:7.6, voc:16.2, temp:23.1, chl:17, pc:6.2, turbidity:14, nitrate:1.8, phosphate:0.061 },
    trend:'rising', depth:2.4
  },
  {
    id:'BG-007', name:'Chautauqua Lake', water:'Chautauqua County, NY',
    lat:42.1620, lon:-79.4050, org:'CLP Alliance',
    x:74, y:26, deployed:'2026-05-02', battery:91, solar:26.8,
    nbState:'idle', runtime:1.2, diffuser:97, treatedToday:505, seed:{ ph:7.62, do:9.1, voc:8.4, temp:21.2, chl:8.5, pc:2.1, turbidity:7, nitrate:0.9, phosphate:0.028 },
    trend:'steady', depth:4.1
  },
  {
    id:'BG-033', name:'Clear Lake', water:'Lake County, CA',
    lat:39.0219, lon:-122.7580, org:'Big Valley Band EPA',
    x:16, y:68, deployed:'2026-02-17', battery:63, solar:31.2,
    nbState:'active', runtime:9.8, diffuser:71, treatedToday:4115, seed:{ ph:8.58, do:5.2, voc:38.1, temp:26.9, chl:47, pc:23.4, turbidity:27, nitrate:3.1, phosphate:0.142 },
    trend:'rising', depth:2.0
  },
  {
    id:'BG-046', name:'Lake Chaohu', water:'Anhui Province, CN',
    lat:31.5500, lon:117.5500, org:'Chaohu Basin Authority',
    x:88, y:70, deployed:'2026-01-09', battery:55, solar:14.7,
    nbState:'idle', runtime:2.6, diffuser:83, treatedToday:1090, seed:{ ph:7.88, do:8.2, voc:12.9, temp:22.4, chl:12.5, pc:4.4, turbidity:11, nitrate:1.4, phosphate:0.044 },
    trend:'falling', depth:3.6
  },
  {
    id:'BG-052', name:'Milford Reservoir', water:'Geary County, KS',
    lat:39.0747, lon:-96.9050, org:'Kansas DHE',
    x:44, y:80, deployed:'2026-06-20', battery:96, solar:28.3,
    nbState:'offline', runtime:0.0, diffuser:62, treatedToday:0, seed:{ ph:7.41, do:9.8, voc:5.1, temp:19.8, chl:5.2, pc:1.2, turbidity:5, nitrate:0.6, phosphate:0.019 },
    trend:'steady', depth:5.4
  }
];

/* ---------------------------------------------------------------
   2b. PROJECTION
   Equirectangular. Output units ARE degrees: x spans 0-360 (lon
   -180..180) and y spans 0-180 (lat 90..-90), so a pin, a coastline
   and a border vertex can never drift out of agreement.
   Coastline and border geometry live in assets/geo.js.
   --------------------------------------------------------------- */
BB.projX = lon => lon + 180;
BB.projY = lat => 90 - lat;

/* ---------------------------------------------------------------
   3. NANOBUBBLE RELEASE LOG
   A release is a burst of aeration, not a consumable. `state` follows
   scheduled -> active -> complete. There is nothing to retrieve: the
   bubbles collapse, the cyanobacteria lyse, and the biomass
   remineralises into the water column in place.
   --------------------------------------------------------------- */
BB.RELEASES = [
  { id:'NB-2291', buoy:'BG-014', state:'active',    start:'2026-08-10 04:12', mins:184,
    o2:5.5, treated:1290, doLift:null, chlDrop:null, trigger:'Risk 74 → auto-release',
    note:'Diffuser ring running at 61% duty over the north shoal. Bubble density holding at target.' },
  { id:'NB-2288', buoy:'BG-014', state:'complete',  start:'2026-08-07 06:40', mins:305,
    o2:9.2, treated:2135, doLift:2.4, chlDrop:71, trigger:'Risk 81 → operator approved',
    note:'Chlorophyll-a down 71% in 26 h and DO up 2.4 mg/L. No residue to recover.' },
  { id:'NB-2274', buoy:'BG-021', state:'complete',  start:'2026-08-05 05:55', mins:142,
    o2:4.3, treated:995, doLift:1.6, chlDrop:58, trigger:'Risk 69 → auto-release',
    note:'Short burst on a rising trend. Caught it early, so a lighter dose of gas was enough.' },
  { id:'NB-2301', buoy:'BG-007', state:'scheduled', start:'2026-08-11 05:00', mins:0,
    o2:0, treated:0, doLift:null, chlDrop:null, trigger:'Pre-dawn window',
    note:'Queued for the pre-dawn oxygen minimum, when the lift from aeration is largest.' },
  { id:'NB-2263', buoy:'BG-033', state:'complete',  start:'2026-08-03 07:20', mins:412,
    o2:12.4, treated:2880, doLift:1.1, chlDrop:44, trigger:'Risk 88 → auto-release',
    note:'Heavy surface scum limited gas exchange. Diffuser flagged for cleaning afterwards.' },
  { id:'NB-2255', buoy:'BG-046', state:'complete',  start:'2026-07-30 05:30', mins:268,
    o2:8.0, treated:1875, doLift:3.1, chlDrop:83, trigger:'Risk 72 → operator approved',
    note:'Best result to date. Water column mixed well after the storm front, so bubbles spread evenly.' }
];

/* ---------------------------------------------------------------
   4. WEEKLY ANALYTICS (per range key)
   --------------------------------------------------------------- */
BB.SUMMARY = {
  daily:{
    title:['Daily','Summary'],
    bars:[{ l:'Water treated m³', v:3110, c:'#3FB6D3' },{ l:'Releases', v:1, c:'#7A5AD1' },{ l:'O₂ kg', v:5.5, c:'#1B6CA8' }],
    max:4200,
    collected:3110, target:4200, cUnit:'M³', cLabel:'Water treated',
    series:[
      { name:'Water temp', unit:'°C', color:'#F0A32E', pts:[22.9,23.1,23.4,24.0,24.4,24.6,24.6] },
      { name:'Chlorophyll-a', unit:'µg/L', color:'#3FA34D', pts:[24,25,27,28,30,31,31] }
    ],
    xl:['00','04','08','12','16','20','24'],
    kpis:[['Aeration','7.4 h'],['Samples','1,416'],['Peak risk','74']]
  },
  weekly:{
    title:['Weekly','Summary'],
    bars:[{ l:'Water treated m³', v:18400, c:'#3FB6D3' },{ l:'Releases', v:6, c:'#7A5AD1' },{ l:'O₂ kg', v:33.2, c:'#1B6CA8' }],
    max:24000,
    collected:18400, target:24000, cUnit:'M³', cLabel:'Water treated',
    series:[
      { name:'Water temp', unit:'°C', color:'#F0A32E', pts:[21.4,21.9,22.6,23.0,23.8,24.2,24.6] },
      { name:'Bloom risk', unit:'score', color:'#1B6CA8', pts:[38,42,47,53,61,68,74] }
    ],
    xl:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    kpis:[['Aeration','44 h'],['Samples','9,912'],['Peak risk','74']]
  },
  monthly:{
    title:['Monthly','Summary'],
    bars:[{ l:'Water treated m³', v:76200, c:'#3FB6D3' },{ l:'Releases', v:22, c:'#7A5AD1' },{ l:'O₂ kg', v:138, c:'#1B6CA8' }],
    max:95000,
    collected:76200, target:95000, cUnit:'M³', cLabel:'Water treated',
    series:[
      { name:'Water temp', unit:'°C', color:'#F0A32E', pts:[17.2,18.6,19.9,21.2,22.4,23.6,24.6] },
      { name:'Bloom risk', unit:'score', color:'#1B6CA8', pts:[22,29,35,44,51,63,74] }
    ],
    xl:['W1','W2','W3','W4','W5','W6','W7'],
    kpis:[['Aeration','182 h'],['Samples','42,760'],['Peak risk','88']]
  },
  yearly:{
    title:['Yearly','Summary'],
    bars:[{ l:'Water treated m³', v:612000, c:'#3FB6D3' },{ l:'Releases', v:148, c:'#7A5AD1' },{ l:'O₂ kg', v:1104, c:'#1B6CA8' }],
    max:750000,
    collected:612000, target:750000, cUnit:'M³', cLabel:'Water treated',
    series:[
      { name:'Water temp', unit:'°C', color:'#F0A32E', pts:[4.1,7.8,13.2,19.4,24.6,18.1,9.2] },
      { name:'Bloom risk', unit:'score', color:'#1B6CA8', pts:[9,14,31,58,74,49,18] }
    ],
    xl:['Jan','Mar','May','Jul','Aug','Oct','Dec'],
    kpis:[['Aeration','1,455 h'],['Samples','512k'],['Peak risk','91']]
  }
};

/* ---------------------------------------------------------------
   5. HELPERS
   --------------------------------------------------------------- */

/* Clamp + normalise a reading to 0..1 where 1 = maximum bloom pressure. */
BB.normalise = function(spec, value){
  const [lo, hi] = spec.span;
  let t = (value - lo) / (hi - lo);
  t = Math.max(0, Math.min(1, t));
  return spec.risk === 'low' ? 1 - t : t;
};

/* Is a reading outside its healthy band? */
BB.isOutOfBand = function(spec, value){
  return value < spec.good[0] || value > spec.good[1];
};

/* Weighted bloom-risk score, 0-100.
   Mirrors the gradient-boosted model in the proposal: normalised
   sensor channels in, single probability-of-bloom out. */
BB.riskScore = function(readings){
  let score = 0, total = 0;
  for (const key in BB.RISK_WEIGHTS){
    const spec = BB.SENSORS[key];
    if (!spec || readings[key] == null) continue;
    const w = BB.RISK_WEIGHTS[key];
    score += BB.normalise(spec, readings[key]) * w;
    total += w;
  }
  const raw = total ? score / total : 0;
  /* light sigmoid shaping so mid-range readings separate more cleanly */
  const shaped = 1 / (1 + Math.exp(-(raw - 0.42) * 6.2));
  return Math.round(Math.max(0, Math.min(100, shaped * 100)));
};

/* Per-channel contribution to the score, sorted by influence. */
BB.riskDrivers = function(readings){
  const out = [];
  for (const key in BB.RISK_WEIGHTS){
    const spec = BB.SENSORS[key];
    if (!spec || readings[key] == null) continue;
    out.push({
      key, name:spec.name, color:spec.color,
      share: BB.normalise(spec, readings[key]) * BB.RISK_WEIGHTS[key]
    });
  }
  const sum = out.reduce((a, d) => a + d.share, 0) || 1;
  out.forEach(d => { d.pct = Math.round(d.share / sum * 100); });
  return out.sort((a, b) => b.pct - a.pct);
};

/* Risk band metadata. */
BB.riskBand = function(score){
  if (score >= 80) return { key:'crit', label:'Critical',  cls:'risk-crit', color:'#DE3B3B', prog:'prog--danger' };
  if (score >= 60) return { key:'high', label:'High',      cls:'risk-high', color:'#E8562A', prog:'prog--danger' };
  if (score >= 35) return { key:'mod',  label:'Elevated',  cls:'risk-mod',  color:'#F0A32E', prog:'prog--amber'  };
  return                  { key:'low',  label:'Low',       cls:'risk-low',  color:'#3FA34D', prog:'prog--leaf'   };
};

/* Seeded pseudo-random walk so each buoy drifts believably but the
   demo is reproducible per session. */
BB.makeWalker = function(seedVal){
  let s = seedVal;
  return function(){
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

/* Build the initial rolling history for a buoy (48 samples ≈ 12 h). */
BB.seedHistory = function(buoy){
  const rnd = BB.makeWalker(buoy.id.charCodeAt(3) * 7919 + 13);
  const hist = {};
  for (const key in BB.SENSORS){
    const base = buoy.seed[key];
    if (base == null) continue;
    const spec = BB.SENSORS[key];
    const drift = (spec.span[1] - spec.span[0]) * 0.012;
    const arr = [];
    let v = base;
    for (let i = 0; i < 48; i++){
      const climb = buoy.trend === 'rising' ? drift * 0.34
                  : buoy.trend === 'falling' ? -drift * 0.26 : 0;
      const bias = spec.risk === 'low' ? -climb : climb;
      v += bias + (rnd() - 0.5) * drift * 1.5;
      arr.push(v);
    }
    /* Shift the whole walk so it *lands* on the seed value — assigning the
       last sample directly would leave a cliff at the right edge. */
    const shift = base - arr[arr.length - 1];
    for (let i = 0; i < arr.length; i++){
      arr[i] = Math.max(spec.span[0], Math.min(spec.span[1], arr[i] + shift));
    }
    hist[key] = arr;
  }
  return hist;
};

/* Advance one sample for a buoy's history in place. */
BB.tickHistory = function(buoy, hist, rnd, boost){
  for (const key in hist){
    const spec = BB.SENSORS[key];
    const arr = hist[key];
    const drift = (spec.span[1] - spec.span[0]) * 0.010;
    let v = arr[arr.length - 1];
    const climb = buoy.trend === 'rising' ? drift * 0.16
                : buoy.trend === 'falling' ? -drift * 0.14 : 0;
    const bias = spec.risk === 'low' ? -climb : climb;
    /* `boost` drives the demo bloom event / aeration knockdown */
    const forced = spec.risk === 'low' ? -boost * drift * 3.2 : boost * drift * 3.2;
    v += bias + forced + (rnd() - 0.5) * drift * 1.35;
    v = Math.max(spec.span[0], Math.min(spec.span[1], v));
    arr.push(v);
    if (arr.length > 48) arr.shift();
  }
};

/* Latest reading map from a history object. */
BB.latest = function(hist){
  const out = {};
  for (const key in hist) out[key] = hist[key][hist[key].length - 1];
  return out;
};

/* Formatting */
BB.fmt = function(key, value){
  const spec = BB.SENSORS[key];
  if (!spec || value == null) return '—';
  return value.toFixed(spec.dp);
};
BB.ago = function(mins){
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm ago';
  const h = Math.floor(mins / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
};
BB.coord = function(lat, lon){
  const la = Math.abs(lat).toFixed(4) + '° ' + (lat >= 0 ? 'N' : 'S');
  const lo = Math.abs(lon).toFixed(4) + '° ' + (lon >= 0 ? 'E' : 'W');
  return la + ', ' + lo;
};
