import { setText, toggleClass } from './dom-safe.js';

function show(el) { if (el) el.classList.remove('is-hidden'); }
function hide(el) { if (el) el.classList.add('is-hidden'); }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ui = {
    auth: document.getElementById('admin-auth'),
    forbidden: document.getElementById('admin-forbidden'),
    dashboard: document.getElementById('admin-dashboard'),
    loginBtn: document.getElementById('admin-login-btn'),
    reloginBtn: document.getElementById('admin-relogin-btn'),
    refreshBtn: document.getElementById('admin-refresh-btn'),
    dau: document.getElementById('metric-dau'),
    visits: document.getElementById('metric-visits'),
    newUsers: document.getElementById('metric-new'),
    returning: document.getElementById('metric-returning'),
    unique: document.getElementById('metric-unique'),
    avg7: document.getElementById('metric-avg7'),
    avg30: document.getElementById('metric-avg30'),
    chart: document.getElementById('dau-chart'),
    chartOldest: document.getElementById('chart-oldest'),
    chartNewest: document.getElementById('chart-newest'),
    tableBody: document.getElementById('metrics-table-body'),
    timezone: document.getElementById('admin-timezone')
};

const lastPaint = {
    panel: '',
    summaryKey: '',
    chartKey: '',
    tableKey: ''
};

function formatNumber(n) {
    return Number(n || 0).toLocaleString('ko-KR');
}

function safeDate(value) {
    const text = typeof value === 'string' ? value : '';
    return DATE_PATTERN.test(text) ? text : '—';
}

function average(values) {
    if (!values.length) return 0;
    const sum = values.reduce((acc, n) => acc + n, 0);
    return Math.round((sum / values.length) * 10) / 10;
}

function seriesKey(days, field) {
    return days.map((day) => `${safeDate(day.date)}:${Number(day[field]) || 0}`).join('|');
}

function renderChart(days) {
    const svg = ui.chart;
    const chronological = days.slice().reverse();
    const chartKey = seriesKey(chronological, 'dau');
    if (chartKey === lastPaint.chartKey && svg.childNodes.length) return;
    lastPaint.chartKey = chartKey;

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const max = Math.max(1, ...chronological.map((d) => Number(d.dau) || 0));
    const n = chronological.length;
    const viewW = 300;
    const viewH = 120;
    const gap = 2;
    const barW = (viewW - gap * (n - 1)) / n;
    const chartH = 108;

    chronological.forEach((day, i) => {
        const dau = Number(day.dau) || 0;
        const h = dau > 0 ? Math.max(3, (dau / max) * chartH) : 0;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(i * (barW + gap)));
        rect.setAttribute('y', String(viewH - h));
        rect.setAttribute('width', String(Math.max(barW, 1)));
        rect.setAttribute('height', String(h));
        rect.setAttribute('rx', '1.5');
        rect.setAttribute('class', i === n - 1 ? 'metrics-bar metrics-bar--today' : 'metrics-bar');
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        setText(title, `${safeDate(day.date)} · DAU ${dau}`);
        rect.appendChild(title);
        svg.appendChild(rect);
    });

    setText(ui.chartOldest, chronological[0] ? safeDate(chronological[0].date) : '');
    setText(ui.chartNewest, chronological[n - 1] ? safeDate(chronological[n - 1].date) : '');
}

function renderTable(days) {
    const tbody = ui.tableBody;
    const tableKey = days.map((day) => (
        `${safeDate(day.date)}:${Number(day.dau) || 0}:${Number(day.visits) || 0}:${Number(day.newUsers) || 0}:${Number(day.returningUsers) || 0}`
    )).join('|');
    if (tableKey === lastPaint.tableKey && tbody.childNodes.length === days.length) return;
    lastPaint.tableKey = tableKey;

    days.forEach((day, rowIndex) => {
        let tr = tbody.children[rowIndex];
        if (!tr) {
            tr = document.createElement('tr');
            for (let i = 0; i < 5; i++) tr.appendChild(document.createElement('td'));
            tbody.appendChild(tr);
        }
        const cells = [
            safeDate(day.date),
            formatNumber(day.dau),
            formatNumber(day.visits),
            formatNumber(day.newUsers),
            formatNumber(day.returningUsers)
        ];
        for (let i = 0; i < 5; i++) setText(tr.children[i], cells[i]);
    });

    while (tbody.children.length > days.length) {
        tbody.removeChild(tbody.lastChild);
    }
}

function renderMetrics(data) {
    const today = data.today || {};
    const days = Array.isArray(data.days) ? data.days : [];
    const summaryKey = [
        today.dau, today.visits, today.newUsers, today.returningUsers,
        data.totals?.uniqueUsers,
        average(days.slice(0, 7).map((d) => Number(d.dau) || 0)),
        average(days.map((d) => Number(d.dau) || 0))
    ].join(':');

    if (summaryKey !== lastPaint.summaryKey) {
        lastPaint.summaryKey = summaryKey;
        setText(ui.dau, formatNumber(today.dau));
        setText(ui.visits, formatNumber(today.visits));
        setText(ui.newUsers, formatNumber(today.newUsers));
        setText(ui.returning, formatNumber(today.returningUsers));
        setText(ui.unique, formatNumber(data.totals?.uniqueUsers));
        setText(ui.avg7, formatNumber(average(days.slice(0, 7).map((d) => Number(d.dau) || 0))));
        setText(ui.avg30, formatNumber(average(days.map((d) => Number(d.dau) || 0))));
        setText(ui.timezone, '한국 시간(KST) 기준 · 로그인 사용자만 집계 · 식별 정보는 해시로만 저장');
    }

    renderChart(days);
    renderTable(days);
}

function showPanel(name) {
    if (lastPaint.panel === name) return;
    lastPaint.panel = name;
    hide(ui.auth);
    hide(ui.forbidden);
    hide(ui.dashboard);
    if (name === 'auth') show(ui.auth);
    if (name === 'forbidden') show(ui.forbidden);
    if (name === 'dashboard') show(ui.dashboard);
}

async function loadMetrics() {
    const response = await fetch('/api/admin/metrics', { credentials: 'same-origin' });
    if (response.status === 401) {
        showPanel('auth');
        return;
    }
    if (!response.ok) {
        showPanel('forbidden');
        return;
    }
    const data = await response.json();
    renderMetrics(data);
    showPanel('dashboard');
}

function cleanOAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_complete') !== '1') return;
    window.history.replaceState(null, '', window.location.pathname || '/admin');
}

function startAdminLogin() {
    window.location.assign('/api/auth/login?next=/admin');
}

ui.loginBtn?.addEventListener('click', startAdminLogin);
ui.reloginBtn?.addEventListener('click', startAdminLogin);

ui.refreshBtn?.addEventListener('click', async () => {
    if (!ui.refreshBtn || ui.refreshBtn.disabled) return;
    ui.refreshBtn.disabled = true;
    toggleClass(ui.refreshBtn, 'refreshing', true);
    try {
        await loadMetrics();
    } finally {
        setTimeout(() => {
            ui.refreshBtn.disabled = false;
            toggleClass(ui.refreshBtn, 'refreshing', false);
        }, 800);
    }
});

cleanOAuthReturn();
loadMetrics().catch(() => showPanel('auth'));
