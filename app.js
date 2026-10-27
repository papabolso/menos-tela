'use strict';

/* ---------- Constantes ---------- */
const KEY = 'menos-tela:v1';
// w = peso do período. Noite pesa menos: tela perto de dormir atrapalha o sono.
// from/to = horas do relógio que cada período cobre na contagem (madrugada entra na manhã).
const PERIODS = [
  { id: 'm', name: 'Manhã', prep: 'de manhã', w: 0.9, from: 0, to: 12 },
  { id: 't', name: 'Tarde', prep: 'à tarde', w: 1.0, from: 12, to: 18 },
  { id: 'n', name: 'Noite', prep: 'à noite', w: 0.8, from: 18, to: 24 },
];
const PACES = [
  { step: 20, name: 'Intenso', desc: '−20 min por dia' },
  { step: 12, name: 'Moderado', desc: '−12 min por dia' },
  { step: 8, name: 'Gradual', desc: '−8 min por dia' },
];
const MAX_FIRST_CUT = 120; // corte máximo no 1º dia (min)
// Presente só dentro do app Android: lê o tempo de tela direto do sistema.
const Native = window.MenosTelaNative || null;

const svg = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;
const ICON = {
  m: svg('<path d="M17 18a5 5 0 0 0-10 0"/><path d="M12 3v6M4.2 10.2l1.4 1.4M2 18h2M20 18h2M18.4 11.6l1.4-1.4M22 22H2"/>'),
  t: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  n: svg('<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.6 6.6 0 0 0 10 10z"/>'),
  ok: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  warn: svg('<path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4M12 17h.01"/>'),
  bad: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>'),
};

/* ---------- Estado ---------- */
let state = load();
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { settings: null, days: {}, sync: null }; }
  catch { return { settings: null, days: {}, sync: null }; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  // Os widgets do Android calculam a meta sozinhos a partir destas configurações.
  if (Native && Native.saveSettings && state.settings) Native.saveSettings(JSON.stringify(state.settings));
}

/* ---------- Utilidades ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmm = (min) => `${pad(Math.floor(((min % 1440) + 1440) % 1440 / 60))}:${pad(((min % 60) + 60) % 60)}`;
const round5 = (x) => Math.round(x / 5) * 5;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 864e5);
const sumDay = (day) => PERIODS.reduce((a, p) => a + (day[p.id] || 0), 0);
const sum = (arr) => arr.reduce((a, x) => a + x, 0);
const avg = (arr) => (arr.length ? sum(arr) / arr.length : null);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmt(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}
function dateLabel(s, opts = { weekday: 'long', day: 'numeric', month: 'short' }) {
  const txt = parseIso(s).toLocaleDateString('pt-BR', opts).replace(/\./g, '');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
const kpis = (items) => items.map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

/* ---------- Motor do plano ---------- */
// Meta do 1º dia: corta metade da distância até o objetivo (máx. 2h).
function startGoal(s) {
  const gap = s.baseline - s.target;
  if (gap <= 0) return s.target;
  return round5(s.baseline - Math.min(gap / 2, MAX_FIRST_CUT));
}
function goalFor(s, date) {
  const i = Math.max(0, daysBetween(s.startDate, date));
  return Math.max(s.target, round5(startGoal(s) - s.step * i));
}
function daysToTarget(s) { return Math.max(0, Math.ceil((startGoal(s) - s.target) / s.step)); }

// Faixas acordado de cada período, usadas para sugerir a divisão da meta.
function periodBounds(s) {
  const w = toMin(s.wake);
  let sl = toMin(s.sleep);
  if (sl <= w) sl += 1440;
  return {
    m: [w, Math.max(w + 60, 720)],
    t: [Math.max(720, w), 1080],
    n: [1080, Math.max(1140, sl)],
  };
}
function baseRecs(s, goal) {
  const b = periodBounds(s);
  const weights = PERIODS.map((p) => Math.max(60, b[p.id][1] - b[p.id][0]) * p.w);
  const total = sum(weights);
  const r = {};
  PERIODS.forEach((p, i) => (r[p.id] = goal * weights[i] / total));
  return r;
}

// Seletor de hora em 12h facilita marcar 11:45 (manhã) querendo 23:45. Ninguém dorme entre a hora
// de acordar e as 18h, então nesse caso troca AM/PM (11:45 → 23:45, 13:00 → 01:00).
function fixSleep(wake, sleep) {
  const w = toMin(wake), sl = toMin(sleep);
  if (sl > w && sl < 1080) return hhmm(sl < 720 ? sl + 720 : sl - 720);
  return sleep;
}

// O dia vira à meia-noite, igual ao Bem-estar digital. Acordar/dormir só servem para dividir a meta.
function nowInfo(s, now = new Date()) {
  const t = now.getHours() * 60 + now.getMinutes();
  const pid = t < 720 ? 'm' : t < 1080 ? 't' : 'n';
  const b = periodBounds(s)[pid];
  const frac = clamp((t - b[0]) / (b[1] - b[0]), 0, 1);
  return { date: iso(now), pid, frac, calDate: iso(now), hour: now.getHours() };
}

function getDay(date) { return state.days[date] || { m: 0, t: 0, n: 0 }; }
function touchDay(date) {
  if (!state.days[date]) state.days[date] = { m: 0, t: 0, n: 0 };
  state.days[date].goal = goalFor(state.settings, date);
  return state.days[date];
}

function analyze(s, date, pid) {
  const day = getDay(date);
  const goal = goalFor(s, date);
  const base = baseRecs(s, goal);
  const idx = PERIODS.findIndex((p) => p.id === pid);
  const used = sumDay(day);
  const pastUsed = PERIODS.slice(0, idx).reduce((a, p) => a + day[p.id], 0);
  const remaining = Math.max(0, goal - pastUsed);
  const futBase = PERIODS.slice(idx).reduce((a, p) => a + base[p.id], 0);
  const adj = {};
  PERIODS.forEach((p, i) => (adj[p.id] = i < idx ? base[p.id] : remaining * base[p.id] / futBase));
  return { day, goal, base, adj, used, idx };
}

function buildAlerts(info, a) {
  const out = [];
  const cur = PERIODS[a.idx];
  const curUsed = a.day[cur.id];
  const curRec = a.adj[cur.id];

  if (a.used > a.goal) {
    out.push(['bad', `Meta do dia estourada em <b>${fmt(a.used - a.goal)}</b>. Tente parar por hoje, amanhã é um novo dia.`]);
  }
  PERIODS.slice(0, a.idx).forEach((p) => {
    const over = a.day[p.id] - a.base[p.id];
    if (over >= 10 && a.used <= a.goal) {
      out.push(['info', `${p.name} passou ${fmt(over)} do sugerido, então os próximos períodos foram reduzidos.`]);
    }
  });
  if (a.used <= a.goal) {
    const share = curUsed / a.goal;
    const baseShare = a.base[cur.id] / a.goal;
    if (curUsed > a.base[cur.id] && curUsed >= 10) {
      const rest = PERIODS.slice(a.idx + 1);
      const tail = rest.length ? ` para sobrar tempo ${rest.length > 1 ? 'à tarde e à noite' : 'à noite'}` : '';
      out.push(['warn', `Você já gastou <b>${Math.round(share * 100)}%</b> do tempo do dia só ${cur.prep} (o ideal é ~${Math.round(baseShare * 100)}%). Tente largar o celular${tail}.`]);
    } else if (curUsed >= curRec * 0.8 && curRec > 0 && curUsed >= 10) {
      out.push(['warn', `Quase no limite ${cur.prep}: restam <b>${fmt(curRec - curUsed)}</b> para este período.`]);
    } else if (info.frac > 0.1 && curUsed > curRec * info.frac * 1.3 && curUsed >= 15) {
      out.push(['warn', `Ritmo acelerado: desse jeito você fecha ${cur.prep} com ~<b>${fmt(curUsed / info.frac)}</b> (sugerido ${fmt(curRec)}).`]);
    }
  }
  return out;
}

/* ---------- Leitura automática (app Android) ---------- */
const hasUsage = () => !!Native && Native.hasUsagePermission();
const reports = {}; // relatórios por dia (os passados não mudam, então ficam em cache)

function report(date, fresh = false) {
  if (!hasUsage() || !Native.getDayReport) return null;
  if (reports[date] && !fresh) return reports[date];
  try {
    reports[date] = JSON.parse(Native.getDayReport(parseIso(date).getTime(), parseIso(addDays(date, 1)).getTime()));
  } catch { reports[date] = null; }
  return reports[date];
}
function nativeSync() {
  if (!state.settings || !hasUsage()) return;
  const s = state.settings, today = nowInfo(s).date;
  for (const date of [addDays(today, -1), today]) {
    if (date < s.startDate) continue;
    const r = report(date, date === today);
    if (!r || !r.hours || !r.hours.length) continue;
    const day = date === today ? touchDay(date) : (state.days[date] || touchDay(date));
    PERIODS.forEach((p) => (day[p.id] = Math.round(sum(r.hours.slice(p.from, p.to)))));
    day.unlocks = r.unlocks;
  }
  state.lastAuto = Date.now();
  save();
}
// Total de um dia: do Android se disponível, senão do que foi registrado.
function dayTotal(date) {
  const r = report(date);
  if (r) return r.total;
  return state.days[date] ? sumDay(state.days[date]) : null;
}
function avg7(today) {
  const vals = [];
  for (let i = 1; i <= 7; i++) { const v = dayTotal(addDays(today, -i)); if (v > 5) vals.push(v); }
  return avg(vals);
}
// Média dos últimos 7 dias completos, para o onboarding.
function nativeAverage() {
  const today = iso(new Date());
  const vals = [];
  for (let i = 1; i <= 7; i++) { const r = report(addDays(today, -i)); if (r && r.total > 5) vals.push(r.total); }
  return vals.length ? { avg: avg(vals), n: vals.length } : null;
}

const iconCache = {};
function appIcon(pkg, name) {
  if (Native && Native.getAppIcon) {
    if (!(pkg in iconCache)) iconCache[pkg] = Native.getAppIcon(pkg) || '';
    if (iconCache[pkg]) return `<img class="app-icon" src="${iconCache[pkg]}" alt="">`;
  }
  return `<span class="app-icon">${esc((name || '?').charAt(0).toUpperCase())}</span>`;
}

/* ---------- Gráficos ---------- */
// Barras por hora (24). Cor por período ou cor única; horas futuras ficam apagadas.
function hourlySvg(hours, { nowHour = 24, single = false } = {}) {
  const W = 336, H = 120, top = 12, bottom = 18, n = 24, gap = 3;
  const bw = (W - gap * (n - 1)) / n;
  const max = Math.max(...hours, 0);
  const maxY = single ? Math.max(15, Math.ceil(max / 15) * 15) : 60;
  const y = (v) => H - bottom - (H - top - bottom) * v / maxY;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Uso por hora">`;
  [maxY, maxY / 2].forEach((v) => {
    s += `<line class="grid" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="2 4"/>`;
    s += `<text x="${W}" y="${y(v) - 3}" text-anchor="end">${v >= 60 && v % 60 === 0 ? v / 60 + 'h' : v + 'min'}</text>`;
  });
  for (let i = 0; i < n; i++) {
    const x = i * (bw + gap);
    const v = hours[i] || 0;
    if (i > nowHour) { s += `<rect class="b-dim" x="${x}" y="${H - bottom - 2}" width="${bw}" height="2" rx="1"/>`; continue; }
    const h = v > 0 ? Math.max(2, (H - top - bottom) * v / maxY) : 2;
    const cls = v <= 0 ? 'b-dim' : single ? 'b-acc' : i < 12 ? 'b-m' : i < 18 ? 'b-t' : 'b-n';
    s += `<rect class="${cls}" x="${x}" y="${H - bottom - h}" width="${bw}" height="${h}" rx="2"/>`;
  }
  [0, 6, 12, 18].forEach((hr) => (s += `<text x="${hr * (bw + gap)}" y="${H - 4}">${hr}h</text>`));
  return s + '</svg>';
}

// Barras dos últimos dias, com marca da meta de cada dia (quando houver).
function weekSvg(items) {
  const W = 336, H = 150, top = 18, bottom = 20, n = items.length, gap = 14;
  const bw = (W - gap * (n - 1)) / n;
  const maxY = Math.max(60, ...items.map((d) => Math.max(d.v || 0, d.goal || 0))) * 1.12;
  const y = (v) => H - bottom - (H - top - bottom) * v / maxY;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Uso por dia">`;
  s += `<line class="grid" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}"/>`;
  items.forEach((d, i) => {
    const x = i * (bw + gap);
    if (d.v == null) {
      s += `<rect class="b-dim" x="${x}" y="${H - bottom - 2}" width="${bw}" height="2" rx="1"/>`;
    } else {
      const h = Math.max(2, H - bottom - y(d.v));
      const cls = d.goal == null ? 'b-acc' : d.v <= d.goal ? 'b-acc' : 'b-bad';
      s += `<rect class="${cls}" x="${x}" y="${H - bottom - h}" width="${bw}" height="${h}" rx="5" opacity="${d.today ? 1 : 0.85}"/>`;
      s += `<text class="val" x="${x + bw / 2}" y="${H - bottom - h - 5}" text-anchor="middle">${fmt(d.v)}</text>`;
    }
    if (d.goal != null) s += `<line class="goal-tick" x1="${x - 2}" x2="${x + bw + 2}" y1="${y(d.goal)}" y2="${y(d.goal)}"/>`;
    s += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle"${d.today ? ' class="val"' : ''}>${d.label}</text>`;
  });
  return s + '</svg>';
}

function lastDays(today, n = 7) {
  const s = state.settings;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({
      date, v: dayTotal(date), today: i === 0,
      goal: date >= s.startDate ? (state.days[date]?.goal ?? goalFor(s, date)) : null,
      label: i === 0 ? 'Hoje' : dateLabel(date, { weekday: 'short' }).slice(0, 3),
    });
  }
  return out;
}

function appRows(apps, { limit = Infinity, days = 1 } = {}) {
  if (!apps.length) return '<div class="empty">Nenhum uso registrado ainda.</div>';
  const top = apps[0].min;
  const total = sum(apps.map((a) => a.min));
  return apps.slice(0, limit).map((a) => {
    const opens = days > 1 ? `${Math.round(a.opens / days)} aberturas/dia` : `${a.opens} ${a.opens === 1 ? 'abertura' : 'aberturas'}`;
    return `<button class="app" data-app="${esc(a.pkg)}">
      ${appIcon(a.pkg, a.name)}
      <div style="min-width:0"><div class="app-name">${esc(a.name)}</div><div class="app-sub">${opens}</div>
        <div class="app-bar"><span style="width:${a.min / top * 100}%"></span></div></div>
      <div><div class="app-time">${fmt(a.min / days)}</div><div class="app-pct">${Math.round(a.min / total * 100)}%</div></div>
    </button>`;
  }).join('');
}

/* ---------- Render: Hoje ---------- */
function renderToday() {
  const s = state.settings;
  const info = nowInfo(s);
  const a = analyze(s, info.date, info.pid);
  const auto = hasUsage();
  const r = auto ? report(info.date) : null;
  const alerts = buildAlerts(info, a);

  $('#today-date').textContent = dateLabel(info.date);
  $('#today-day').textContent = `Dia ${daysBetween(s.startDate, info.date) + 1} do plano`;

  // Destaque
  const level = a.used > a.goal ? 'bad' : alerts.some((x) => x[0] === 'warn') ? 'warn' : 'ok';
  const status = $('#hero-status');
  status.className = `status ${level}`;
  status.textContent = level === 'bad' ? 'Acima da meta' : level === 'warn' ? 'Dá uma reduzida' : 'Tranquilo';
  $('#hero-used').textContent = fmt(a.used);
  $('#hero-goal').textContent = `de ${fmt(a.goal)}`;
  const bar = $('#hero-bar');
  bar.style.width = `${clamp(a.goal ? a.used / a.goal : 0, 0, 1) * 100}%`;
  bar.style.background = `var(--${level === 'ok' ? 'accent' : level})`;
  $('#hero-sub').textContent = a.used > a.goal
    ? `${fmt(a.used - a.goal)} acima da meta de hoje`
    : `Restam ${fmt(a.goal - a.used)} para a meta de hoje`;

  const yesterday = dayTotal(addDays(info.date, -1));
  const mean = avg7(info.date);
  $('#hero-kpis').innerHTML = kpis([
    auto && r ? [r.unlocks, 'desbloqueios'] : [streak(info.date), 'dias seguidos'],
    [yesterday ? fmt(yesterday) : '—', 'ontem'],
    [mean ? fmt(mean) : '—', 'média 7 dias'],
  ]);

  $('#alerts').innerHTML = alerts.map(([k, msg]) => `<div class="alert ${k}">${ICON[k]}<span>${msg}</span></div>`).join('');

  // Permissão / registro manual
  const card = $('#auto-card');
  card.hidden = !Native || auto;
  $('#sync-card').hidden = !!Native;
  if (Native && !auto) {
    card.innerHTML = `<div><h2>Leitura automática</h2><p class="muted small" style="margin-top:4px">Libere o acesso ao uso para o app ler seu tempo de tela e a análise por app sozinho.</p></div>
      <button class="btn primary" id="btn-perm">Permitir acesso ao uso</button>`;
  }

  // Períodos
  $('#periods').innerHTML = PERIODS.map((p, i) => {
    const used = a.day[p.id];
    const rec = round5(a.adj[p.id]);
    const ratio = rec > 0 ? used / rec : used > 0 ? 2 : 0;
    const cls = ratio > 1 ? 'bad' : ratio >= 0.8 ? 'warn' : '';
    const note = used > rec ? `<div class="period-note bad">+${fmt(used - rec)}</div>`
      : i >= a.idx ? `<div class="period-note">restam ${fmt(rec - used)}</div>`
      : '<div class="period-note">dentro</div>';
    return `<button class="period p-${p.id} ${i === a.idx ? 'now' : ''}" ${auto ? 'disabled' : `data-edit="${p.id}"`}>
      <div class="period-top"><span class="row">${ICON[p.id]}${p.name}</span>${i === a.idx ? '<span class="now-dot" title="agora"></span>' : ''}</div>
      <div class="period-val">${fmt(used)}</div>
      <div class="period-of">de ${fmt(rec)}</div>
      <div class="mini ${cls}"><span style="width:${clamp(ratio, 0, 1) * 100}%"></span></div>
      ${note}
    </button>`;
  }).join('');

  // Por hora e apps (só com dados do Android)
  $('#hourly-card').hidden = !r;
  $('#top-card').hidden = !r;
  if (r) {
    $('#hourly').innerHTML = hourlySvg(r.hours, { nowHour: info.hour });
    const peak = r.hours.indexOf(Math.max(...r.hours));
    $('#hourly-hint').textContent = r.total > 0 ? `pico às ${peak}h · ${fmt(r.hours[peak])}` : '';
    $('#top-apps').innerHTML = appRows(r.apps, { limit: 5 });
  }
}

function streak(today) {
  const s = state.settings;
  let n = 0;
  for (let d = addDays(today, -1); state.days[d]; d = addDays(d, -1)) {
    if (sumDay(state.days[d]) <= (state.days[d].goal ?? goalFor(s, d))) n++; else break;
  }
  return n;
}

/* ---------- Render: Apps ---------- */
let appsRange = 1;
function aggregateApps(today, days) {
  const map = {};
  const hours = new Array(24).fill(0);
  let unlocks = 0, total = 0, counted = 0;
  for (let i = 0; i < days; i++) {
    const r = report(addDays(today, -i));
    if (!r || !r.hours.length) continue;
    counted++;
    unlocks += r.unlocks; total += r.total;
    r.hours.forEach((v, h) => (hours[h] += v));
    r.apps.forEach((a) => {
      const m = map[a.pkg] || (map[a.pkg] = { pkg: a.pkg, name: a.name, min: 0, opens: 0 });
      m.min += a.min; m.opens += a.opens;
    });
  }
  const apps = Object.values(map).sort((x, y) => y.min - x.min);
  return { apps, hours, unlocks, total, counted };
}
function renderApps() {
  const body = $('#apps-body');
  $$('#apps-range button').forEach((b) => b.classList.toggle('on', Number(b.dataset.range) === appsRange));
  if (!hasUsage()) {
    body.innerHTML = `<div class="card empty">${Native
      ? 'Libere o acesso ao uso na aba Hoje para ver a análise por app.'
      : 'A análise por app funciona no app Android, que lê o uso de cada aplicativo.'}</div>`;
    return;
  }
  const info = nowInfo(state.settings);
  const g = aggregateApps(info.date, appsRange);
  const d = appsRange === 1 ? 1 : Math.max(1, g.counted);
  const per = appsRange === 1 ? '' : '/dia';
  body.innerHTML = `
    <div class="card kpis">${kpis([
      [fmt(g.total / d), appsRange === 1 ? 'tempo de tela' : 'média por dia'],
      [Math.round(g.unlocks / d), `desbloqueios${per}`],
      [g.apps.length, 'apps usados'],
    ])}</div>
    <article class="card">
      <div class="card-head"><h2>${appsRange === 1 ? 'Por hora' : 'Média por hora'}</h2>
        <span class="hint"><i class="lg-dot m"></i> manhã <i class="lg-dot t"></i> tarde <i class="lg-dot n"></i> noite</span></div>
      <div class="chart">${hourlySvg(g.hours.map((v) => v / d), { nowHour: appsRange === 1 ? info.hour : 24 })}</div>
    </article>
    <article class="card">
      <div class="card-head"><h2>Todos os apps</h2><span class="hint">${appsRange === 1 ? 'hoje' : 'média diária'}</span></div>
      <div class="app-list">${appRows(g.apps, { days: d })}</div>
    </article>`;
}

function openAppSheet(pkg) {
  const today = nowInfo(state.settings).date;
  const days = [];
  let todayApp = null;
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    const r = report(date);
    const a = r ? r.apps.find((x) => x.pkg === pkg) : null;
    if (i === 0) todayApp = a;
    days.push({ date, v: r ? (a ? a.min : 0) : null, today: i === 0, goal: null,
      label: i === 0 ? 'Hoje' : dateLabel(date, { weekday: 'short' }).slice(0, 3) });
  }
  const name = todayApp?.name || reports[days.find((x) => x.v)?.date]?.apps.find((x) => x.pkg === pkg)?.name || pkg;
  const past = days.slice(0, 6).map((x) => x.v).filter((v) => v != null);
  const mean = avg(past);
  $('#sheet-body').innerHTML = `
    <div class="sheet-head">${appIcon(pkg, name)}<div><h2>${esc(name)}</h2><p class="muted small">${todayApp ? `${fmt(todayApp.min)} hoje` : 'Sem uso hoje'}</p></div></div>
    <div class="kpis">${kpis([
      [todayApp ? fmt(todayApp.min) : '0min', 'hoje'],
      [mean != null ? fmt(mean) : '—', 'média 6 dias'],
      [todayApp ? todayApp.opens : 0, 'aberturas hoje'],
    ])}</div>
    <h3>Hoje por hora</h3>
    <div class="chart">${hourlySvg(todayApp ? todayApp.hours : new Array(24).fill(0), { nowHour: new Date().getHours(), single: true })}</div>
    <h3>Últimos 7 dias</h3>
    <div class="chart">${weekSvg(days)}</div>`;
  $('#app-sheet').showModal();
}
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-app]');
  if (row) openAppSheet(row.dataset.app);
  const go = e.target.closest('[data-goto]');
  if (go) show(go.dataset.goto);
});
$('#apps-range').addEventListener('click', (e) => {
  const b = e.target.closest('[data-range]');
  if (!b) return;
  appsRange = Number(b.dataset.range);
  renderApps();
});

/* ---------- Render: Plano ---------- */
function renderPlan() {
  const s = state.settings;
  const info = nowInfo(s);
  const dN = daysToTarget(s);
  const reach = addDays(s.startDate, dN);
  const today = goalFor(s, info.date);
  const reached = today <= s.target;

  $('#plan-stats').innerHTML = kpis([
    [fmt(s.baseline), 'média inicial'],
    [fmt(today), 'meta de hoje'],
    [reached ? 'Atingida' : dateLabel(reach, { day: 'numeric', month: 'short' }), reached ? `meta final ${fmt(s.target)}` : `chega em ${fmt(s.target)}`],
  ]);

  const elapsed = daysBetween(s.startDate, info.date);
  const N = Math.max(dN + 4, elapsed + 3, 10);
  const W = 336, H = 170, L = 26, R = 6, T = 10, B = 20;
  let maxY = s.baseline;
  for (let i = 0; i <= elapsed; i++) maxY = Math.max(maxY, dayTotal(addDays(s.startDate, i)) || 0);
  maxY = Math.ceil((maxY + 30) / 60) * 60;
  const x = (i) => L + (W - L - R) * i / N;
  const y = (v) => T + (H - T - B) * (1 - v / maxY);

  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Meta diária ao longo do plano">`;
  const stepH = maxY > 600 ? 120 : 60;
  for (let v = 0; v <= maxY; v += stepH) {
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v / 60}h</text>`;
  }
  g += `<line class="target" x1="${L}" x2="${W - R}" y1="${y(s.target)}" y2="${y(s.target)}"/>`;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(`${x(i)},${y(goalFor(s, addDays(s.startDate, i)))}`);
  g += `<polyline class="goal" points="${pts.join(' ')}"/>`;
  if (elapsed >= 0 && elapsed <= N) g += `<line class="today" x1="${x(elapsed)}" x2="${x(elapsed)}" y1="${T}" y2="${H - B}"/>`;
  for (let i = 0; i <= Math.min(elapsed, N); i++) {
    const date = addDays(s.startDate, i);
    const used = dayTotal(date);
    if (used == null) continue;
    const goal = state.days[date]?.goal ?? goalFor(s, date);
    g += `<circle class="${used <= goal ? 'dot-ok' : 'dot-bad'}" cx="${x(i)}" cy="${y(used)}" r="3.5"/>`;
  }
  const every = Math.ceil(N / 6);
  for (let i = 0; i <= N; i += every) {
    g += `<text x="${x(i)}" y="${H - 5}" text-anchor="middle">${dateLabel(addDays(s.startDate, i), { day: 'numeric', month: 'numeric' })}</text>`;
  }
  $('#plan-chart').innerHTML = g + '</svg>';

  const rec = baseRecs(s, today);
  const b = periodBounds(s);
  $('#plan-split').innerHTML = PERIODS.map((p) => `<div class="split-row" style="color:var(--p-${p.id})">${ICON[p.id]}
      <div style="color:var(--text)"><div class="row between"><span>${p.name}</span><span class="muted small">${hhmm(b[p.id][0])}–${hhmm(b[p.id][1])}</span></div>
      <div class="mini"><span style="width:${rec[p.id] / today * 100}%;background:var(--p-${p.id})"></span></div></div>
      <b style="color:var(--text)" class="num">${fmt(round5(rec[p.id]))}</b></div>`).join('');
}

/* ---------- Render: Histórico ---------- */
function renderHistory() {
  const s = state.settings;
  const info = nowInfo(s);
  const dates = Object.keys(state.days).filter((d) => d <= info.date).sort().reverse();
  const finished = dates.filter((d) => d < info.date);
  const hit = finished.filter((d) => sumDay(state.days[d]) <= (state.days[d].goal ?? goalFor(s, d))).length;
  const mean = avg7(info.date);

  $('#hist-stats').innerHTML = kpis([
    [streak(info.date), 'dias seguidos na meta'],
    [mean ? fmt(mean) : '—', 'média 7 dias'],
    [finished.length ? `${hit}/${finished.length}` : '—', 'dias cumpridos'],
  ]);
  $('#week-chart').innerHTML = weekSvg(lastDays(info.date));

  if (!dates.length) {
    $('#hist-list').innerHTML = '<div class="card empty">Nenhum dia registrado ainda.</div>';
    return;
  }
  $('#hist-list').innerHTML = dates.map((d) => {
    const day = state.days[d];
    const used = sumDay(day);
    const goal = day.goal ?? goalFor(s, d);
    const scale = Math.max(used, goal) * 1.05 || 1;
    const mark = d === info.date ? '' : used <= goal ? '<span class="ok-t">✓</span>' : '<span class="bad-t">✗</span>';
    return `<div class="hist">
      <div class="hist-top"><span class="d">${d === info.date ? 'Hoje' : dateLabel(d, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        <span class="num"><b>${fmt(used)}</b> <span class="muted">/ ${fmt(goal)}</span> ${mark}</span></div>
      <div class="stack">${PERIODS.map((p) => `<span style="width:${day[p.id] / scale * 100}%"></span>`).join('')}
        <i class="goal-mark" style="left:${goal / scale * 100}%"></i></div>
      <div class="hist-sub"><span><i class="lg-dot m"></i> ${fmt(day.m)}</span><span><i class="lg-dot t"></i> ${fmt(day.t)}</span><span><i class="lg-dot n"></i> ${fmt(day.n)}</span>${day.unlocks != null ? `<span>${day.unlocks} desbloqueios</span>` : ''}</div>
    </div>`;
  }).join('');
}

/* ---------- Render: Ajustes ---------- */
function renderSettings() {
  const s = state.settings;
  $('#set-baseline').value = s.baseline / 60;
  $('#set-target').value = s.target / 60;
  $('#set-wake').value = s.wake;
  $('#set-sleep').value = s.sleep;
  showPeriods('#set-periods', s.wake, s.sleep);
  $('#set-pace').innerHTML = PACES.map((p) => `<option value="${p.step}" ${p.step === s.step ? 'selected' : ''}>${p.name} (${p.desc})</option>`).join('');
  const a = recentAverage();
  $('#restart-hint').textContent = a
    ? `Recomeça a progressão a partir de hoje usando sua média dos últimos dias (${fmt(a)}) como ponto de partida.`
    : 'Recomeça a progressão a partir de hoje.';
}
// Mostra os períodos em 24h, para não ter dúvida de AM/PM.
function showPeriods(sel, wake, sleep) {
  if (!wake || !sleep) return;
  const b = periodBounds({ wake, sleep: fixSleep(wake, sleep) });
  $(sel).textContent = PERIODS.map((p) => `${p.name} ${hhmm(b[p.id][0])}–${hhmm(b[p.id][1])}`).join(' · ');
}
['#set-wake', '#set-sleep'].forEach((id) => $(id).addEventListener('input', () =>
  showPeriods('#set-periods', $('#set-wake').value, $('#set-sleep').value)));
['#ob-wake', '#ob-sleep'].forEach((id) => $(id).addEventListener('input', () =>
  showPeriods('#ob-periods', $('#ob-wake').value, $('#ob-sleep').value)));

function recentAverage() {
  const m = avg7(nowInfo(state.settings).date);
  return m ? round5(m) : null;
}

/* ---------- Navegação ---------- */
let currentView = 'today';
function render() {
  if (!state.settings) return;
  ({ today: renderToday, apps: renderApps, plan: renderPlan, history: renderHistory, settings: renderSettings })[currentView]();
}
function show(view) {
  currentView = view;
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
  render();
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

/* ---------- Ações: registrar uso (sem Android) ---------- */
function addToCurrent(min) {
  const info = nowInfo(state.settings);
  const day = touchDay(info.date);
  day[info.pid] = Math.max(0, day[info.pid] + min);
  save(); render();
  return PERIODS.find((p) => p.id === info.pid).name;
}

$('#sync-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const total = Number($('#sync-h').value || 0) * 60 + Number($('#sync-m').value || 0);
  if (!total) return toast('Digite o tempo que aparece no celular.');
  const info = nowInfo(state.settings);
  // Compara com a última leitura do mesmo dia.
  const prev = state.sync && state.sync.date === info.calDate ? state.sync.total : 0;
  const delta = total - prev;
  if (delta < 0) return toast(`Você já tinha registrado ${fmt(prev)} hoje. Para corrigir, toque no período.`);
  state.sync = { date: info.calDate, total };
  const name = addToCurrent(delta);
  $('#sync-h').value = ''; $('#sync-m').value = '';
  toast(delta ? `+${fmt(delta)} na ${name}. Se parte foi em outro período, toque no card para ajustar.` : 'Nada novo desde a última atualização.');
});

$$('[data-add]').forEach((b) => b.addEventListener('click', () => {
  const min = Number(b.dataset.add);
  const name = addToCurrent(min);
  if (state.sync && state.sync.date === nowInfo(state.settings).calDate) state.sync.total += min;
  save();
  toast(`+${min}min na ${name}`);
}));

$('#auto-card').addEventListener('click', (e) => {
  if (e.target.id === 'btn-perm') Native.openUsageSettings();
});

// Editar período
let editing = null;
$('#periods').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-edit]');
  if (!btn) return;
  editing = btn.dataset.edit;
  const v = getDay(nowInfo(state.settings).date)[editing];
  $('#edit-title').textContent = PERIODS.find((p) => p.id === editing).name;
  $('#edit-h').value = Math.floor(v / 60);
  $('#edit-m').value = v % 60;
  $('#edit-dialog').showModal();
});
$('#edit-dialog').addEventListener('close', () => {
  if ($('#edit-dialog').returnValue !== 'save' || !editing) return;
  const day = touchDay(nowInfo(state.settings).date);
  day[editing] = Number($('#edit-h').value || 0) * 60 + Number($('#edit-m').value || 0);
  save(); render();
  editing = null;
});

/* ---------- Ajustes ---------- */
$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const baseline = round5(Number($('#set-baseline').value) * 60);
  const target = round5(Number($('#set-target').value) * 60);
  if (!(target > 0) || target >= baseline) return toast('A meta final precisa ser menor que a média inicial.');
  const wake = $('#set-wake').value, sleep = fixSleep(wake, $('#set-sleep').value);
  Object.assign(state.settings, { baseline, target, wake, sleep, step: Number($('#set-pace').value) });
  touchDay(nowInfo(state.settings).date);
  nativeSync();
  save(); toast(sleep !== $('#set-sleep').value ? `Salvo! Entendi que você dorme às ${sleep}.` : 'Salvo!'); render();
});
$('#btn-restart').addEventListener('click', () => {
  if (!confirm('Recomeçar o plano a partir de hoje?')) return;
  const a = recentAverage();
  const s = state.settings;
  if (a && a > s.target) s.baseline = a;
  s.startDate = nowInfo(s).date;
  touchDay(s.startDate);
  save(); toast('Plano recomeçado.'); render();
});
$('#btn-export').addEventListener('click', () => {
  if (Native) return Native.shareBackup(JSON.stringify(state));
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `menos-tela-backup-${iso(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.settings || !data.days) throw new Error();
    state = data; save(); toast('Backup importado.'); render();
  } catch { toast('Arquivo inválido.'); }
  e.target.value = '';
});
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Apagar todos os dados e configurações?')) return;
  state = { settings: null, days: {}, sync: null };
  save(); startOnboarding();
});

/* ---------- Onboarding ---------- */
const ob = { step: 0, pace: 12 };
function startOnboarding() {
  $('#app').hidden = true;
  $('#onboarding').hidden = false;
  ob.step = 0;
  $('#ob-paces').innerHTML = PACES.map((p) =>
    `<button class="pace ${p.step === ob.pace ? 'sel' : ''}" data-pace="${p.step}"><span><b>${p.name}</b><span class="muted small">${p.desc}</span></span>${p.step === 12 ? '<span class="rec">Recomendado</span>' : ''}</button>`).join('');
  obRender();
}
function obSettings() {
  const wake = $('#ob-wake').value || '07:00';
  return {
    baseline: round5(Number($('#ob-baseline').value) * 60),
    target: round5(Number($('#ob-target').value) * 60),
    wake,
    sleep: fixSleep(wake, $('#ob-sleep').value || '23:45'),
    step: ob.pace,
    startDate: iso(new Date()),
  };
}
function obRender() {
  $$('.ob-step').forEach((el) => (el.hidden = Number(el.dataset.step) !== ob.step));
  $('#ob-bar').style.width = `${(ob.step + 1) * 25}%`;
  $('#ob-back').hidden = ob.step === 0;
  $('#ob-next').textContent = ob.step === 3 ? 'Começar' : 'Continuar';

  const bl = Number($('#ob-baseline').value);
  const tg = $('#ob-target');
  tg.max = Math.max(1, bl - 0.25);
  if (Number(tg.value) >= bl) tg.value = Math.max(1, bl - 2);
  $('#ob-baseline-label').textContent = fmt(bl * 60);
  $('#ob-target-label').textContent = fmt(Number(tg.value) * 60);

  const s = obSettings();
  const n = daysToTarget(s);
  $('#ob-preview').innerHTML = `Você começa com <b>${fmt(startGoal(s))}</b> já hoje e chega em <b>${fmt(s.target)}</b> em <b>${n + 1} dias</b>, por volta de ${dateLabel(addDays(s.startDate, n), { day: 'numeric', month: 'long' })}.`;
}
function obApplyRealAvg() {
  const r = nativeAverage();
  if (!r) { $('#ob-real-note').textContent = 'Ainda não há dados de uso suficientes no celular.'; return; }
  $('#ob-baseline').value = clamp(Math.round(r.avg / 15) / 4, 2, 16);
  $('#ob-real-note').textContent = `Sua média real nos últimos ${r.n} dias foi ${fmt(r.avg)}.`;
  obRender();
}
let obWaitingPerm = false;
$('#ob-real-avg').hidden = !Native;
$('#ob-real-avg').addEventListener('click', () => {
  if (hasUsage()) return obApplyRealAvg();
  obWaitingPerm = true;
  Native.openUsageSettings();
});
$('#ob-baseline').addEventListener('input', obRender);
$('#ob-target').addEventListener('input', obRender);
$('#ob-paces').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pace]');
  if (!b) return;
  ob.pace = Number(b.dataset.pace);
  $$('.pace').forEach((x) => x.classList.toggle('sel', x === b));
  obRender();
});
$('#ob-back').addEventListener('click', () => { ob.step--; obRender(); });
$('#ob-next').addEventListener('click', () => {
  if (ob.step < 3) { ob.step++; obRender(); return; }
  state.settings = obSettings();
  touchDay(state.settings.startDate);
  save();
  enterApp();
});

function enterApp() {
  $('#onboarding').hidden = true;
  $('#app').hidden = false;
  nativeSync();
  show('today');
}

/* ---------- Início ---------- */
if (state.settings) {
  state.settings.sleep = fixSleep(state.settings.wake, state.settings.sleep);
  enterApp();
} else {
  startOnboarding();
}
// Atualiza quando o app volta ao primeiro plano e a cada minuto (troca de período/dia).
const refresh = () => { nativeSync(); if (currentView !== 'settings') render(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(refresh, 60_000);

// Chamados pelo app Android.
window.onNativeResume = () => {
  if (!state.settings) { if (obWaitingPerm && hasUsage()) { obWaitingPerm = false; obApplyRealAvg(); } return; }
  refresh();
};
window.onNativeBack = () => {
  for (const d of ['#app-sheet', '#edit-dialog']) if ($(d).open) { $(d).close(); return true; }
  if (state.settings && currentView !== 'today') { show('today'); return true; }
  if (!state.settings && ob.step > 0) { ob.step--; obRender(); return true; }
  return false;
};

if (!Native && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
