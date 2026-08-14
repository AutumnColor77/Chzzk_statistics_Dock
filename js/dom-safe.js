/**
 * XSS-safe DOM helpers. Never use innerHTML / outerHTML with untrusted data.
 * textContent and setAttribute(text) do not parse markup.
 */

export function toSafeText(value) {
    if (value == null) return '';
    return String(value);
}

/** HTML entity escape — attribute/text fallback when a string must be interpolated. */
export function escapeHtml(value) {
    return toSafeText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function setText(el, value) {
    if (!el) return false;
    const next = toSafeText(value);
    if (el.textContent === next) return false;
    el.textContent = next;
    return true;
}

export function clearChildren(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
}

export function setAttrIfChanged(el, name, value) {
    if (!el) return false;
    const next = toSafeText(value);
    if (el.getAttribute(name) === next) return false;
    el.setAttribute(name, next);
    return true;
}

export function toggleClass(el, className, on) {
    if (!el) return false;
    const has = el.classList.contains(className);
    if (Boolean(on) === has) return false;
    el.classList.toggle(className, Boolean(on));
    return true;
}
