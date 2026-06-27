import { clearLocalSessionState } from './state.js';
import { revokeToken } from './api.js';

const AUTH_CHANNEL_NAME = 'cheese-stick-dock-auth';
const AUTH_SUCCESS = { type: 'CHZZK_AUTH_SUCCESS' };

function signalAuthSuccessToOtherWindows() {
    try {
        const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
        channel.postMessage(AUTH_SUCCESS);
        channel.close();
    } catch (_e) {
        // ignore
    }
    try {
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage(AUTH_SUCCESS, window.location.origin);
            window.opener.focus();
        }
    } catch (_e) {
        // ignore
    }
}

/**
 * 팝업 대신 같은 탭에서 OAuth를 진행합니다.
 * 브라우저가 script로 연 팝업의 window.close()를 막는 환경에서도 안정적으로 동작합니다.
 */
export function login() {
    window.location.assign('/api/auth/login');
}

export async function logout() {
    await revokeToken();
    clearLocalSessionState();
}

/**
 * OAuth 콜백 후 서버가 /?oauth_complete=1 로 리다이렉트한 경우 세션을 반영합니다.
 * @returns {boolean} OAuth 복귀를 처리했으면 true
 */
export function handleOAuthReturn(onSuccess) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_complete') !== '1') return false;

    window.history.replaceState(null, '', window.location.pathname || '/');

    if (window.opener && !window.opener.closed) {
        signalAuthSuccessToOtherWindows();
        try {
            window.close();
        } catch (_e) {
            // ignore
        }
    }

    onSuccess();
    return true;
}
