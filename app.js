'use strict';

/* ---------- Constantes ---------- */
const KEY = 'menos-tela:v1';
// w = peso do período. Noite pesa menos: tela perto de dormir atrapalha o sono.
const PERIODS = [
  { id: 'm', name: 'Manhã', prep: 'de manhã', icon: '☀️', w: 0.9 },
  { id: 't', name: 'Tarde', prep: 'à tarde', icon: '🌤️', w: 1.0 },
  { id: 'n', name: 'Noite', prep: 'à noite', icon: '🌙', w: 0.8 },
];
const PACES = [
  { step: 20, name: 'Intenso', desc: '−20 min por dia' },
  { step: 12, name: 'Moderado', desc: '−12 min por dia' },
  { step: 8, name: 'Gradual', desc: '−8 min por dia' },
];
const MAX_FIRST_CUT = 120; // corte máximo no 1º dia (min)
// Presente só dentro do app Android: lê o tempo de tela direto do sistema.
const Native = window.MenosTelaNative || null;

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

function fmt(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}
function fmtHours(h) { return fmt(h * 60); }
function dateLabel(s, opts = { weekday: 'long', day: 'numeric', month: 'short' }) {
  const txt = parseIso(s).toLocaleDateString('pt-BR', opts).replace(/\./g, '');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

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

// Limites de cada período em minutos do relógio (noite pode passar da meia-noite).
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
  const total = weights.reduce((a, x) => a + x, 0);
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

// O dia vira à meia-noite, igual ao Bem-estar digital. Acordar/dormir só servem para dividir a meta;
// uso de madrugada conta na manhã.
function nowInfo(s, now = new Date()) {
  const t = now.getHours() * 60 + now.getMinutes();
  const pid = t < 720 ? 'm' : t < 1080 ? 't' : 'n';
  const b = periodBounds(s)[pid];
  const frac = clamp((t - b[0]) / (b[1] - b[0]), 0, 1);
  return { date: iso(now), pid, frac, calDate: iso(now) };
}

function getDay(date) { return state.days[date] || { m: 0, t: 0, n: 0 }; }
function touchDay(date) {
  if (!state.days[date]) state.days[date] = { m: 0, t: 0, n: 0 };
  state.days[date].goal = goalFor(state.settings, date);
  return state.days[date];
}

/* ---------- Leitura automática (app Android) ---------- */
const hasUsage = () => !!Native && Native.hasUsagePermission();

// Intervalos reais (epoch ms) de cada período do dia, de meia-noite a meia-noite.
function periodRanges(s, date) {
  const at = (min, plusDays = 0) => {
    const d = parseIso(date); d.setDate(d.getDate() + plusDays); d.setMinutes(min); return d.getTime();
  };
  return { m: [at(0), at(720)], t: [at(720), at(1080)], n: [at(1080), at(0, 1)] };
}
function nativeSync() {
  if (!state.settings || !hasUsage()) return;
  const s = state.settings, now = Date.now(), today = nowInfo(s).date;
  for (const date of [addDays(today, -1), today]) {
    if (date < s.startDate) continue;
    const r = periodRanges(s, date);
    const day = date === today ? touchDay(date) : (state.days[date] || touchDay(date));
    PERIODS.forEach((p) => {
      const [a, b] = r[p.id];
      day[p.id] = a < now ? Math.round(Native.getUsage(a, Math.min(b, now)) / 60000) : 0;
    });
  }
  state.lastAuto = now;
  save();
}
// Média dos últimos 7 dias completos (meia-noite a meia-noite), ignorando dias sem uso.
function nativeAverage() {
  const vals = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const end = d.getTime(); d.setDate(d.getDate() - 1);
    const min = Native.getUsage(d.getTime(), end) / 60000;
    if (min > 5) vals.push(min);
  }
  return vals.length ? { avg: vals.reduce((a, x) => a + x, 0) / vals.length, n: vals.length } : null;
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

function buildAlerts(s, info, a) {
  const out = [];
  const cur = PERIODS[a.idx];
  const curUsed = a.day[cur.id];
  const curRec = a.adj[cur.id];

  if (a.used > a.goal) {
    out.push(['bad', '🚨', `Meta do dia estourada em <b>${fmt(a.used - a.goal)}</b>. Tente parar por hoje — amanhã é um novo dia.`]);
  }

  // Períodos anteriores que passaram do recomendado
  PERIODS.slice(0, a.idx).forEach((p) => {
    const over = a.day[p.id] - a.base[p.id];
    if (over >= 10 && a.used <= a.goal) {
      out.push(['info', 'ℹ️', `${p.name} passou ${fmt(over)} do recomendado, então os próximos períodos foram reduzidos.`]);
    }
  });

  if (a.used <= a.goal) {
    const share = curUsed / a.goal;
    const baseShare = a.base[cur.id] / a.goal;
    if (curUsed > a.base[cur.id] && curUsed >= 10) {
      const restNames = PERIODS.slice(a.idx + 1).map((p) => p.name.toLowerCase());
      const rest = restNames.length ? ` para sobrar tempo ${restNames.length > 1 ? 'à tarde e à noite' : 'à noite'}` : '';
      out.push(['warn', '⚠️', `Você já gastou <b>${Math.round(share * 100)}%</b> do seu tempo diário só ${cur.prep} (o ideal é ~${Math.round(baseShare * 100)}%). Tente largar o celular${rest}.`]);
    } else if (curUsed >= curRec * 0.8 && curRec > 0 && curUsed >= 10) {
      out.push(['warn', '⏳', `Quase no limite ${cur.prep}: restam <b>${fmt(curRec - curUsed)}</b> para este período.`]);
    } else if (info.frac > 0.1 && curUsed > curRec * info.frac * 1.3 && curUsed >= 15) {
      const proj = curUsed / info.frac;
      out.push(['warn', '🏃', `Ritmo acelerado: desse jeito você fecha ${cur.prep} com ~<b>${fmt(proj)}</b> (recomendado ${fmt(curRec)}).`]);
    }
  }

  if (!out.length) {
    out.push(a.used === 0
      ? ['info', '👋', `Hoje a meta é <b>${fmt(a.goal)}</b>. Atualize o tempo de uso ao longo do dia para acompanhar.`]
      : ['ok', '👌', 'Tudo dentro do plano. Segue assim!']);
  }
  return out;
}

/* ---------- Render: Hoje ---------- */
function renderToday() {
  const s = state.settings;
  const info = nowInfo(s);
  const a = analyze(s, info.date, info.pid);
  const dayN = daysBetween(s.startDate, info.date) + 1;

  $('#today-date').textContent = dateLabel(info.date);
  $('#today-day').textContent = `Dia ${dayN} do plano`;

  const C = 2 * Math.PI * 52;
  const pct = a.goal ? a.used / a.goal : 0;
  const fill = $('#ring-fill');
  fill.style.strokeDasharray = C;
  fill.style.strokeDashoffset = C * (1 - clamp(pct, 0, 1));
  fill.style.stroke = pct > 1 ? 'var(--bad)' : pct > 0.85 ? 'var(--warn)' : 'var(--accent)';
  $('#ring-used').textContent = fmt(a.used);
  $('#ring-goal').textContent = `de ${fmt(a.goal)} hoje`;
  const left = $('#ring-left');
  left.textContent = a.used > a.goal ? `${fmt(a.used - a.goal)} acima` : `restam ${fmt(a.goal - a.used)}`;
  left.style.color = a.used > a.goal ? 'var(--bad)' : 'var(--accent)';

  $('#alerts').innerHTML = buildAlerts(s, info, a)
    .map(([k, ic, msg]) => `<div class="alert ${k}"><span class="ic">${ic}</span><span>${msg}</span></div>`).join('');

  const auto = hasUsage();
  const card = $('#auto-card');
  card.hidden = !Native;
  $('#sync-card').hidden = auto;
  if (Native && !auto) {
    card.className = 'card auto need';
    card.innerHTML = `<div class="txt"><h3>Leitura automática</h3><p class="muted small">Libere o acesso ao uso para o app ler seu tempo de tela sozinho, sem precisar digitar nada.</p></div>
      <button class="btn primary" id="btn-perm">Permitir acesso ao uso</button>`;
  } else if (auto) {
    const at = state.lastAuto ? new Date(state.lastAuto).toTimeString().slice(0, 5) : '—';
    card.className = 'card auto';
    card.innerHTML = `<span>📲</span><div class="txt">Lido automaticamente do celular<br><span class="muted small">atualizado às ${at}</span></div>
      <button class="pill" id="btn-refresh">Atualizar</button>`;
  }

  const b = periodBounds(s);
  $('#periods').innerHTML = PERIODS.map((p, i) => {
    const used = a.day[p.id];
    const rec = a.adj[p.id];
    const r = rec > 0 ? used / rec : used > 0 ? 2 : 0;
    const cls = r > 1 ? 'bad' : r >= 0.8 ? 'warn' : '';
    const badge = i === a.idx ? '<span class="period-badge">agora</span>'
      : i < a.idx ? '<span class="period-badge past">encerrado</span>' : '';
    const adjusted = i >= a.idx && Math.abs(rec - a.base[p.id]) >= 5
      ? `<div class="adj">recalculado (era ${fmt(round5(a.base[p.id]))})</div>` : '';
    return `<button class="period ${i === a.idx ? 'now' : ''}" ${auto ? 'disabled' : `data-edit="${p.id}"`}>
      <div class="period-head">
        <span class="period-icon">${p.icon}</span>
        <div><div class="period-name">${p.name}</div><div class="period-range">${hhmm(b[p.id][0])}–${hhmm(b[p.id][1])}</div></div>
        ${badge}
      </div>
      <div class="bar ${cls}"><span style="width:${clamp(r, 0, 1) * 100}%"></span></div>
      <div class="period-foot"><span><b>${fmt(used)}</b> <span class="muted">de ${fmt(round5(rec))}</span></span>
        <span class="muted">${used > round5(rec) ? `<span class="bad-t">+${fmt(used - round5(rec))}</span>` : `${fmt(round5(rec) - used)} livres`}</span></div>
      ${adjusted}
    </button>`;
  }).join('');
}

/* ---------- Render: Plano ---------- */
function renderPlan() {
  const s = state.settings;
  const info = nowInfo(s);
  const dN = daysToTarget(s);
  const reach = addDays(s.startDate, dN);
  const today = goalFor(s, info.date);
  const reached = today <= s.target;

  $('#plan-stats').innerHTML = [
    [fmt(s.baseline), 'média inicial'],
    [fmt(today), 'meta de hoje'],
    [reached ? '✓' : dateLabel(reach, { day: 'numeric', month: 'short' }), reached ? 'meta final atingida' : `chega em ${fmt(s.target)}`],
  ].map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  // Gráfico
  const elapsed = daysBetween(s.startDate, info.date);
  const N = Math.max(dN + 4, elapsed + 3, 10);
  const W = 340, H = 180, L = 30, R = 8, T = 10, B = 22;
  let maxY = s.baseline;
  for (let i = 0; i <= elapsed; i++) maxY = Math.max(maxY, sumDay(getDay(addDays(s.startDate, i))));
  maxY = Math.ceil((maxY + 30) / 60) * 60;
  const x = (i) => L + (W - L - R) * i / N;
  const y = (v) => T + (H - T - B) * (1 - v / maxY);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Meta diária ao longo do plano">`;
  const stepH = maxY > 600 ? 120 : 60;
  for (let v = 0; v <= maxY; v += stepH) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v / 60}h</text>`;
  }
  svg += `<line class="target" x1="${L}" x2="${W - R}" y1="${y(s.target)}" y2="${y(s.target)}"/>`;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(`${x(i)},${y(goalFor(s, addDays(s.startDate, i)))}`);
  svg += `<polyline class="goal" points="${pts.join(' ')}"/>`;
  if (elapsed >= 0 && elapsed <= N) svg += `<line class="today" x1="${x(elapsed)}" x2="${x(elapsed)}" y1="${T}" y2="${H - B}"/>`;
  for (let i = 0; i <= Math.min(elapsed, N); i++) {
    const date = addDays(s.startDate, i);
    if (!state.days[date]) continue;
    const used = sumDay(state.days[date]);
    const g = state.days[date].goal ?? goalFor(s, date);
    svg += `<circle class="${used <= g ? 'dot-ok' : 'dot-bad'}" cx="${x(i)}" cy="${y(used)}" r="3.5"/>`;
  }
  const lblEvery = Math.ceil(N / 6);
  for (let i = 0; i <= N; i += lblEvery) {
    svg += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${dateLabel(addDays(s.startDate, i), { day: 'numeric', month: 'numeric' })}</text>`;
  }
  $('#plan-chart').innerHTML = svg + '</svg>';

  // Divisão do dia
  const rec = baseRecs(s, today);
  const b = periodBounds(s);
  $('#plan-split').innerHTML = PERIODS.map((p) => {
    const pct = rec[p.id] / today;
    return `<div class="split-row"><span>${p.icon}</span>
      <div><div>${p.name} <span class="muted small">${hhmm(b[p.id][0])}–${hhmm(b[p.id][1])}</span></div>
      <div class="bar"><span style="width:${pct * 100}%"></span></div></div>
      <b>${fmt(round5(rec[p.id]))}</b></div>`;
  }).join('');
}

/* ---------- Render: Histórico ---------- */
function renderHistory() {
  const s = state.settings;
  const info = nowInfo(s);
  const dates = Object.keys(state.days).filter((d) => d <= info.date).sort().reverse();

  // Sequência: dias concluídos dentro da meta (hoje só conta se já estiver dentro)
  let streak = 0;
  for (let d = addDays(info.date, -1); state.days[d]; d = addDays(d, -1)) {
    const day = state.days[d];
    if (sumDay(day) <= (day.goal ?? goalFor(s, d))) streak++; else break;
  }
  const last7 = [];
  for (let i = 1; i <= 7; i++) { const d = addDays(info.date, -i); if (state.days[d]) last7.push(sumDay(state.days[d])); }
  const avg = last7.length ? last7.reduce((a, x) => a + x, 0) / last7.length : null;
  const finished = dates.filter((d) => d < info.date);
  const hit = finished.filter((d) => sumDay(state.days[d]) <= (state.days[d].goal ?? goalFor(s, d))).length;

  $('#hist-stats').innerHTML = [
    [`${streak}🔥`, 'dias seguidos na meta'],
    [avg == null ? '—' : fmt(avg), 'média 7 dias'],
    [finished.length ? `${hit}/${finished.length}` : '—', 'dias cumpridos'],
  ].map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  if (!dates.length) {
    $('#hist-list').innerHTML = '<div class="empty">Nenhum dia registrado ainda.</div>';
    return;
  }
  $('#hist-list').innerHTML = dates.map((d) => {
    const day = state.days[d];
    const used = sumDay(day);
    const goal = day.goal ?? goalFor(s, d);
    const scale = Math.max(used, goal) * 1.05 || 1;
    const ok = used <= goal;
    const label = d === info.date ? 'Hoje' : dateLabel(d, { weekday: 'short', day: 'numeric', month: 'short' });
    return `<div class="hist">
      <div class="hist-top"><span class="d">${label}</span>
        <span><b>${fmt(used)}</b> <span class="muted">/ ${fmt(goal)}</span> ${d === info.date ? '' : ok ? '<span class="ok-t">✓</span>' : '<span class="bad-t">✗</span>'}</span></div>
      <div class="stack">${PERIODS.map((p) => `<span style="width:${day[p.id] / scale * 100}%"></span>`).join('')}
        <i class="goal-mark" style="left:${goal / scale * 100}%"></i></div>
      <div class="hist-sub">☀️ ${fmt(day.m)} · 🌤️ ${fmt(day.t)} · 🌙 ${fmt(day.n)}</div>
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
  const avg = recentAverage();
  $('#restart-hint').textContent = avg
    ? `Recomeça a progressão a partir de hoje usando sua média dos últimos dias (${fmt(avg)}) como ponto de partida.`
    : 'Recomeça a progressão a partir de hoje.';
}
// Mostra os períodos em 24h, para não ter dúvida de AM/PM.
function showPeriods(sel, wake, sleep) {
  if (!wake || !sleep) return;
  const b = periodBounds({ wake, sleep: fixSleep(wake, sleep) });
  $(sel).textContent = PERIODS.map((p) => `${p.icon} ${hhmm(b[p.id][0])}–${hhmm(b[p.id][1])}`).join('   ');
}
['#set-wake', '#set-sleep'].forEach((id) => $(id).addEventListener('input', () =>
  showPeriods('#set-periods', $('#set-wake').value, $('#set-sleep').value)));
['#ob-wake', '#ob-sleep'].forEach((id) => $(id).addEventListener('input', () =>
  showPeriods('#ob-periods', $('#ob-wake').value, $('#ob-sleep').value)));

function recentAverage() {
  const info = nowInfo(state.settings);
  const vals = [];
  for (let i = 1; i <= 7; i++) { const d = addDays(info.date, -i); if (state.days[d]) vals.push(sumDay(state.days[d])); }
  return vals.length >= 3 ? round5(vals.reduce((a, x) => a + x, 0) / vals.length) : null;
}

/* ---------- Navegação ---------- */
let currentView = 'today';
function render() {
  if (!state.settings) return;
  ({ today: renderToday, plan: renderPlan, history: renderHistory, settings: renderSettings })[currentView]();
}
function show(view) {
  currentView = view;
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
  render();
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

/* ---------- Ações: registrar uso ---------- */
function addToCurrent(min) {
  const info = nowInfo(state.settings);
  const day = touchDay(info.date);
  day[info.pid] = Math.max(0, day[info.pid] + min);
  save(); render();
  return PERIODS.find((p) => p.id === info.pid).name;
}

$('#sync-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const h = Number($('#sync-h').value || 0), m = Number($('#sync-m').value || 0);
  const total = h * 60 + m;
  if (!total) return toast('Digite o tempo que aparece no celular.');
  const info = nowInfo(state.settings);
  // O celular zera à meia-noite; comparamos com a última leitura do mesmo dia do calendário.
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
  if (e.target.id === 'btn-refresh') { nativeSync(); render(); toast('Atualizado.'); }
});

// Editar período
let editing = null;
$('#periods').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-edit]');
  if (!btn) return;
  editing = btn.dataset.edit;
  const info = nowInfo(state.settings);
  const v = getDay(info.date)[editing];
  $('#edit-title').textContent = PERIODS.find((p) => p.id === editing).name;
  $('#edit-h').value = Math.floor(v / 60);
  $('#edit-m').value = v % 60;
  $('#edit-dialog').showModal();
});
$('#edit-dialog').addEventListener('close', () => {
  if ($('#edit-dialog').returnValue !== 'save' || !editing) return;
  const info = nowInfo(state.settings);
  const day = touchDay(info.date);
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
  const avg = recentAverage();
  const s = state.settings;
  if (avg && avg > s.target) s.baseline = avg;
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
const ob = { step: 0, step_pace: 12 };
function startOnboarding() {
  $('#app').hidden = true;
  $('#onboarding').hidden = false;
  ob.step = 0;
  $('#ob-paces').innerHTML = PACES.map((p) =>
    `<button class="pace ${p.step === ob.step_pace ? 'sel' : ''}" data-pace="${p.step}"><span><b>${p.name}</b><span class="muted small">${p.desc}</span></span><span>${p.step === 12 ? '⭐' : ''}</span></button>`).join('');
  obRender();
}
function obSettings() {
  return {
    baseline: round5(Number($('#ob-baseline').value) * 60),
    target: round5(Number($('#ob-target').value) * 60),
    wake: $('#ob-wake').value || '07:00',
    sleep: fixSleep($('#ob-wake').value || '07:00', $('#ob-sleep').value || '23:45'),
    step: ob.step_pace,
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
  $('#ob-baseline-label').textContent = fmtHours(bl);
  $('#ob-target-label').textContent = fmtHours(Number(tg.value));

  const s = obSettings();
  const first = startGoal(s);
  const n = daysToTarget(s);
  $('#ob-preview').innerHTML = `Você começa com <b>${fmt(first)}</b> já hoje e chega em <b>${fmt(s.target)}</b> em <b>${n + 1} dias</b>, por volta de ${dateLabel(addDays(s.startDate, n), { day: 'numeric', month: 'long' })}.`;
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
  ob.step_pace = Number(b.dataset.pace);
  $$('.pace').forEach((x) => x.classList.toggle('sel', x === b));
  obRender();
});
$('#ob-back').addEventListener('click', () => { ob.step--; obRender(); });
$('#ob-next').addEventListener('click', () => {
  if (ob.step < 3) { ob.step++; obRender(); return; }
  state.settings = obSettings();
  state.settings.startDate = nowInfo(state.settings).date;
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
// Atualiza a tela quando o app volta ao primeiro plano e a cada minuto (troca de período/dia).
const refresh = () => { nativeSync(); if (currentView !== 'settings') render(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(refresh, 60_000);

// Chamados pelo app Android.
window.onNativeResume = () => {
  if (!state.settings) { if (obWaitingPerm && hasUsage()) { obWaitingPerm = false; obApplyRealAvg(); } return; }
  refresh();
};
window.onNativeBack = () => {
  if ($('#edit-dialog').open) { $('#edit-dialog').close(); return true; }
  if (state.settings && currentView !== 'today') { show('today'); return true; }
  if (!state.settings && ob.step > 0) { ob.step--; obRender(); return true; }
  return false;
};

if (!Native && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
