import { clearLocalSessionState } from './state.js';
import { revokeToken } from './api.js';

const MAIN_WINDOW_NAME = 'CheeseStickDockApp';
const AUTH_POPUP_NAME = 'CheeseStickDockAuth';
const AUTH_CHANNEL_NAME = 'cheese-stick-dock-auth';
const AUTH_STORAGE_KEY = 'chzzk_auth_success';

/** @type {Window | null} */
let authPopup = null;
/** @type {ReturnType<typeof setInterval> | null} */
let authWatchInterval = null;

function ensureMainWindowName() {
    if (!window.name) {
        window.name = MAIN_WINDOW_NAME;
    }
}

function closeAuthPopup() {
    try {
        if (authPopup && !authPopup.closed) {
            authPopup.close();
        }
    } catch (_e) {
        // COOP 등으로 WindowProxy 접근이 막힌 경우
    }
    authPopup = null;

    // 메인 창 새로고침 등으로 authPopup 참조가 없어도 이름으로 팝업을 닫을 수 있음
    try {
        const namedPopup = window.open('', AUTH_POPUP_NAME);
        if (namedPopup && namedPopup !== window && !namedPopup.closed) {
            namedPopup.close();
        }
    } catch (_e) {
        // ignore
    }
}

function scheduleCloseAuthPopup() {
    closeAuthPopup();
    window.setTimeout(closeAuthPopup, 100);
    window.setTimeout(closeAuthPopup, 350);
}

function stopAuthWatch() {
    if (authWatchInterval) {
        clearInterval(authWatchInterval);
        authWatchInterval = null;
    }
}

function startAuthWatch() {
    stopAuthWatch();
    authWatchInterval = window.setInterval(() => {
        try {
            const ts = localStorage.getItem(AUTH_STORAGE_KEY);
            if (ts && Date.now() - Number(ts) < 120000) {
                localStorage.removeItem(AUTH_STORAGE_KEY);
                notifyAuthSuccess();
            }
        } catch (_e) {
            // ignore
        }
        if (authPopup && authPopup.closed) {
            authPopup = null;
        }
    }, 250);
}

let onAuthSuccess = () => {};
let authHandled = false;

function notifyAuthSuccess() {
    if (authHandled) return;
    authHandled = true;
    stopAuthWatch();
    scheduleCloseAuthPopup();
    try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (_e) {
        // ignore
    }
    onAuthSuccess();
}

export function login() {
    ensureMainWindowName();

    const width = 500;
    const height = 600;
    const left = (window.innerWidth / 2) - (width / 2);
    const top = (window.innerHeight / 2) - (height / 2);

    if (authPopup && !authPopup.closed) {
        authPopup.focus();
        return;
    }

    authHandled = false;
    authPopup = window.open(
        '/api/auth/login',
        AUTH_POPUP_NAME,
        `width=${width},height=${height},top=${top},left=${left}`
    );

    if (!authPopup) {
        authPopup = null;
        window.location.assign('/api/auth/login');
        return;
    }

    startAuthWatch();
}

export async function logout() {
    await revokeToken();
    clearLocalSessionState();
}

export function setupAuthListener(onSuccess) {
    ensureMainWindowName();
    onAuthSuccess = onSuccess;
    authHandled = false;

    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== 'CHZZK_AUTH_SUCCESS') return;
        if (authPopup && event.source !== authPopup) return;
        if (!authPopup && !event.source) return;
        notifyAuthSuccess();
    });

    window.addEventListener('storage', (event) => {
        if (event.key === AUTH_STORAGE_KEY && event.newValue) {
            notifyAuthSuccess();
        }
    });

    try {
        const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
        channel.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'CHZZK_AUTH_SUCCESS') {
                notifyAuthSuccess();
            }
        });
    } catch (_e) {
        // BroadcastChannel 미지원
    }
}
