/** Musi być bez importu firebase.js — inaczej baza łączy się przed przekierowaniem. */
const PI_AP_GATEWAY = "10.42.0.1";

function isLocalLanHost(hostname) {
    return /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * Host na LAN (192.168.1.52) + goście na AP (10.42.0.1) = dwa osobne pokoje.
 * Przekieruj hosta na http://10.42.0.1 (hotspot PartBox-Gry).
 * ?lan=1 — wyłącza (testy z PC w sieci domowej).
 */
export function maybeRedirectToApGateway() {
    if (typeof window === "undefined") return false;

    const { hostname, pathname, search, hash, protocol } = window.location;
    const params = new URLSearchParams(search);

    if (params.has("lan")) return false;
    if (hostname === PI_AP_GATEWAY || hostname === "localhost") return false;
    if (!isLocalLanHost(hostname)) return false;

    const target = `${protocol}//${PI_AP_GATEWAY}${pathname}${search}${hash}`;
    window.location.replace(target);
    return true;
}
