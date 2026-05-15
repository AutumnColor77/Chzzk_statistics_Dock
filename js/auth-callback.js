(function () {
    'use strict';

    var TARGET_ORIGIN = window.location.origin;

    function notifyOpenerAndClose() {
        try {
            if (window.opener && !window.opener.closed) {
                window.opener.postMessage({ type: 'CHZZK_AUTH_SUCCESS' }, TARGET_ORIGIN);
                window.close();
                return;
            }
        } catch (_e) {
            // opener 접근 실패(다른 origin으로 이동했거나 차단됨) — 폴백 진행
        }

        // opener가 없으면 일정 시간 후 메인 페이지로 자체 이동.
        window.setTimeout(function () {
            window.location.replace('/');
        }, 1200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', notifyOpenerAndClose, { once: true });
    } else {
        notifyOpenerAndClose();
    }
})();
