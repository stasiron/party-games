import { useState } from 'react';
import { firebaseConnection, PI_AP_GATEWAY } from '../lib/firebase';

const STORAGE_KEY = 'party-ios-wifi-help-dismissed';

function isAppleMobile() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function IosWifiHelp() {
    const [dismissed, setDismissed] = useState(() => {
        try {
            return localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    });

    if (firebaseConnection.mode !== 'emulator' || !isAppleMobile() || dismissed) {
        return null;
    }

    const dismiss = () => {
        try {
            localStorage.setItem(STORAGE_KEY, '1');
        } catch {
            /* private mode */
        }
        setDismissed(true);
    };

    return (
        <aside className="ios-wifi-help" role="note">
            <p className="ios-wifi-help__title">iPhone / iPad — jak połączyć się z PartBox</p>
            <ul className="ios-wifi-help__list">
                <li>
                    Przy Wi‑Fi <strong>PartBox-Gry</strong> wybierz <strong>Użyj bez internetu</strong> / dołącz mimo
                    komunikatu o „niezabezpieczonej sieci” — to normalne przy imprezie offline (bez hasła WPA).
                </li>
                <li>
                    Ustawienia → Wi‑Fi → (i) przy PartBox-Gry → wyłącz <strong>Prywatny adres Wi‑Fi</strong> i{' '}
                    <strong>Ogranicz śledzenie adresu IP</strong> — inaczej telefony widzą różne „światy” pokoi.
                </li>
                <li>
                    W przeglądarce wpisz <strong>http://{PI_AP_GATEWAY}</strong> (nie https).
                </li>
                <li>Wszyscy gracze muszą mieć ten sam adres w pasku URL co host.</li>
            </ul>
            <button type="button" className="ios-wifi-help__dismiss" onClick={dismiss}>
                Rozumiem, ukryj
            </button>
        </aside>
    );
}

export default IosWifiHelp;
