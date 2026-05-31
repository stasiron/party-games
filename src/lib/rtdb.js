export { ref, push, remove, onValue, onDisconnect, child, runTransaction } from 'firebase/database';
export { piSet as set, piUpdate as update, piGet as get } from './rtdbThrottle';

/** Firebase RTDB odrzuca zapis regułami jako PERMISSION_DENIED (code lub message). */
export function isRtdbPermissionDenied(err) {
    if (!err || typeof err !== 'object') return false;
    const code = err.code != null ? String(err.code) : '';
    const message = err.message != null ? String(err.message) : '';
    return /permission_denied/i.test(code) || /permission_denied/i.test(message);
}
