// --- LocalStorage Cache for Live Status ---
const LOCAL_CACHE_KEY = 'chzzk_live_status_cache';
const LOCAL_CACHE_MAX_AGE_MS = 120 * 1000; // 로컬 캐시 유효 기간: 2분

function getCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
}

function getCsrfTokenOrThrow() {
    const token = getCookie('chzzk_csrf');
    if (!token) {
        throw new Error('CSRF token missing — please log in again.');
    }
    return token;
}

function saveToLocalCache(channelId, data) {
    try {
        const entry = { channelId, data, timestamp: Date.now() };
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(entry));
    } catch (_e) {
        // LocalStorage 용량 초과 등 — 무시
    }
}

function loadFromLocalCache(channelId) {
    try {
        const raw = localStorage.getItem(LOCAL_CACHE_KEY);
        if (!raw) return null;

        const entry = JSON.parse(raw);
        if (entry.channelId !== channelId) return null;
        if (Date.now() - entry.timestamp > LOCAL_CACHE_MAX_AGE_MS) return null;

        return entry.data;
    } catch (_e) {
        return null;
    }
}

/**
 * 라이브 상태를 가져옵니다.
 * 성공 시 LocalStorage에 캐싱하고, 서버 장애 시 로컬 캐시로 폴백합니다.
 */
export async function fetchLiveStatus(channelId, force = false) {
    let url = `/api/live-status?channelId=${encodeURIComponent(channelId)}`;
    if (force) url += '&force=true';

    try {
        const response = await fetch(url, { credentials: 'same-origin' });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const cacheStatus = response.headers.get('X-Cache') || 'UNKNOWN';

        saveToLocalCache(channelId, data);
        return { data, source: 'server', cacheStatus };

    } catch (error) {
        const cachedData = loadFromLocalCache(channelId);
        if (cachedData) {
            return { data: cachedData, source: 'local-cache', cacheStatus: 'LOCAL' };
        }
        throw error;
    }
}

export async function fetchUserChannel() {
    return fetch('/api/users/me', { credentials: 'same-origin' });
}

export async function fetchLiveSettings() {
    return fetch('/api/lives/setting', { credentials: 'same-origin' });
}

export async function updateLiveSettings(body) {
    const csrfToken = getCsrfTokenOrThrow();
    return fetch('/api/lives/setting', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(body)
    });
}

export async function searchCategories(query) {
    if (!query) return null;
    const res = await fetch(`/api/categories/search?query=${encodeURIComponent(query)}`, {
        credentials: 'same-origin'
    });
    if (res.ok) {
        return res.json();
    }
    throw new Error('Search failed');
}

export async function revokeToken() {
    let csrfToken = '';
    try {
        csrfToken = getCsrfTokenOrThrow();
    } catch (_e) {
        // 토큰이 없으면 굳이 서버에 요청하지 않습니다 (이미 로그아웃 상태로 간주).
        return;
    }
    try {
        await fetch('/api/auth/revoke', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': csrfToken }
        });
    } catch (_e) {
        // revoke 실패해도 로컬 로그아웃은 진행
    }
}
