import { globals } from './state.js';

// --- LocalStorage Cache for Live Status ---
const LOCAL_CACHE_KEY = 'chzzk_live_status_cache';
const LOCAL_CACHE_MAX_AGE_MS = 120 * 1000; // 로컬 캐시 유효 기간: 2분

/**
 * 라이브 상태 데이터를 LocalStorage에 캐싱합니다.
 */
function saveToLocalCache(channelId, data) {
    try {
        const entry = {
            channelId,
            data,
            timestamp: Date.now()
        };
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(entry));
    } catch (_e) {
        // LocalStorage 용량 초과 등 — 무시
    }
}

/**
 * LocalStorage에서 캐싱된 라이브 상태를 가져옵니다.
 * 유효 기간(2분)이 지난 캐시는 null을 반환합니다.
 */
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
 *
 * @returns {{ data: object, source: 'server'|'local-cache' }}
 */
export async function fetchLiveStatus(channelId) {
    const url = `/api/live-status?channelId=${channelId}`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const cacheStatus = response.headers.get('X-Cache') || 'UNKNOWN';

        // 서버 응답 성공 → LocalStorage에 백업 저장
        saveToLocalCache(channelId, data);

        return { data, source: 'server', cacheStatus };

    } catch (error) {
        // 서버 장애 (KV 초과, 네트워크 오류, 502 등) → 로컬 캐시 폴백
        const cachedData = loadFromLocalCache(channelId);
        if (cachedData) {
            return { data: cachedData, source: 'local-cache', cacheStatus: 'LOCAL' };
        }

        // 로컬 캐시도 없으면 에러 전파
        throw error;
    }
}

export async function fetchUserChannel() {
    if (!globals.accessToken) throw new Error('No access token');
    const response = await fetch('/api/users/me', {
        headers: { 'Authorization': `Bearer ${globals.accessToken}` }
    });
    return response;
}

export async function fetchLiveSettings() {
    if (!globals.accessToken) throw new Error('No access token');
    const response = await fetch('/api/lives/setting', {
        headers: { 'Authorization': `Bearer ${globals.accessToken}` }
    });
    return response;
}

export async function updateLiveSettings(body) {
    if (!globals.accessToken) throw new Error('No access token');
    const response = await fetch('/api/lives/setting', {
        method: 'PATCH',
        headers: { 
            'Authorization': `Bearer ${globals.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    return response;
}

export async function searchCategories(query) {
    if (!query) return null;
    const res = await fetch(`/api/categories/search?query=${encodeURIComponent(query)}`);
    if (res.ok) {
        return res.json();
    }
    throw new Error('Search failed');
}

export async function revokeToken() {
    if (!globals.accessToken) return;
    try {
        await fetch('/api/auth/revoke', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${globals.accessToken}` }
        });
    } catch (_e) {
        // revoke 실패해도 로컬 로그아웃은 진행
    }
}
