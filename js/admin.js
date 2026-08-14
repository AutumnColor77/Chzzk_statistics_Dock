function show(el) { if (el) el.classList.remove('is-hidden'); }
function hide(el) { if (el) el.classList.add('is-hidden'); }

const ui = {
    auth: document.getElementById('admin-auth'),
    forbidden: document.getElementById('admin-forbidden'),
    dashboard: document.getElementById('admin-dashboard'),
    loginBtn: document.getElementById('admin-login-btn'),
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

function formatNumber(n) {
    return Number(n || 0).toLocaleString('ko-KR');
}

function average(values) {
    if (!values.length) return 0;
    const sum = values.reduce((acc, n) => acc + n, 0);
    return Math.round((sum / values.length) * 10) / 10;
}

function renderChart(days) {
    const svg = ui.chart;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const chronological = days.slice().reverse();
    const max = Math.max(1, ...chronological.map((d) => d.dau));
    const n = chronological.length;
    const viewW = 300;
    const viewH = 120;
    const gap = 2;
    const barW = (viewW - gap * (n - 1)) / n;
    const chartH = 108;

    chronological.forEach((day, i) => {
        const h = day.dau > 0 ? Math.max(3, (day.dau / max) * chartH) : 0;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(i * (barW + gap)));
        rect.setAttribute('y', String(viewH - h));
        rect.setAttribute('width', String(Math.max(barW, 1)));
        rect.setAttribute('height', String(h));
        rect.setAttribute('rx', '1.5');
        rect.setAttribute('class', i === n - 1 ? 'metrics-bar metrics-bar--today' : 'metrics-bar');
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${day.date} · DAU ${day.dau}`;
        rect.appendChild(title);
        svg.appendChild(rect);
    });

    if (ui.chartOldest) ui.chartOldest.textContent = chronological[0]?.date || '';
    if (ui.chartNewest) ui.chartNewest.textContent = chronological[n - 1]?.date || '';
}

function renderTable(days) {
    const tbody = ui.tableBody;
    tbody.textContent = '';
    days.forEach((day) => {
        const tr = document.createElement('tr');
        [day.date, day.dau, day.visits, day.newUsers, day.returningUsers].forEach((value, idx) => {
            const td = document.createElement('td');
            td.textContent = idx === 0 ? String(value) : formatNumber(value);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function renderMetrics(data) {
    const today = data.today || {};
    const days = Array.isArray(data.days) ? data.days : [];
    ui.dau.textContent = formatNumber(today.dau);
    ui.visits.textContent = formatNumber(today.visits);
    ui.newUsers.textContent = formatNumber(today.newUsers);
    ui.returning.textContent = formatNumber(today.returningUsers);
    ui.unique.textContent = formatNumber(data.totals?.uniqueUsers);
    ui.avg7.textContent = formatNumber(average(days.slice(0, 7).map((d) => d.dau)));
    ui.avg30.textContent = formatNumber(average(days.map((d) => d.dau)));
    ui.timezone.textContent = '한국 시간(KST) 기준 · 로그인 사용자만 집계 · 식별 정보는 해시로만 저장';
    renderChart(days);
    renderTable(days);
}

function showPanel(name) {
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

ui.loginBtn?.addEventListener('click', () => {
    window.location.assign('/api/auth/login?next=/admin');
});

ui.refreshBtn?.addEventListener('click', async () => {
    if (!ui.refreshBtn || ui.refreshBtn.disabled) return;
    ui.refreshBtn.disabled = true;
    ui.refreshBtn.classList.add('refreshing');
    try {
        await loadMetrics();
    } finally {
        setTimeout(() => {
            ui.refreshBtn.disabled = false;
            ui.refreshBtn.classList.remove('refreshing');
        }, 800);
    }
});

cleanOAuthReturn();
loadMetrics().catch(() => showPanel('auth'));
