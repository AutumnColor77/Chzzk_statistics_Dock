(function () {
    'use strict';

    var TARGET_ORIGIN = window.location.origin;
    var AUTH_CHANNEL_NAME = 'cheese-stick-dock-auth';
    var AUTH_SUCCESS = { type: 'CHZZK_AUTH_SUCCESS' };

    function broadcastAuthSuccess() {
        try {
            var channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
            channel.postMessage(AUTH_SUCCESS);
            channel.close();
        } catch (_e) {
            // BroadcastChannel 미지원 환경 — opener/postMessage에만 의존
        }
    }

    function notifyOpener() {
        try {
            if (window.opener && !window.opener.closed) {
                window.opener.postMessage(AUTH_SUCCESS, TARGET_ORIGIN);
            }
        } catch (_e) {
            // COOP 등으로 opener 접근 불가
        }
    }

    function showCloseHint() {
        var title = document.querySelector('.callback-title');
        var desc = document.querySelector('.callback-desc');
        if (title) title.textContent = '로그인 완료';
        if (desc) desc.textContent = '이 창을 닫고 Cheese Stick Dock으로 돌아가세요.';
    }

    function finishAuth() {
        // COOP(same-origin)로 OAuth 후 opener가 끊겨도 메인 창에 알림
        broadcastAuthSuccess();
        notifyOpener();

        try {
            window.close();
        } catch (_e) {
            // ignore
        }

        // 닫히지 않으면 안내만 표시 — 팝업을 메인 앱(/)으로 보내지 않음
        window.setTimeout(function () {
            if (!window.closed) {
                showCloseHint();
            }
        }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', finishAuth, { once: true });
    } else {
        finishAuth();
    }
})();
