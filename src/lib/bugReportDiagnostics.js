import {
    canAdvanceJustOneRound,
    shouldPauseForJustOneNextRound,
} from './justOneState';
import {
    canAdvanceTelepathyRound,
    shouldPauseForTelepathyNextRound,
} from './telepathyState';
import { getPiQueueDepth, isPiGameSessionActive } from './rtdbThrottle';
import { isLowPowerDevice } from './lowPower';

const SECRET_KEYS_EXACT = new Set([
    'word',
    'password',
    'secretword',
    'telepathyword',
    'justoneclue',
    'impostorids',
    'impostorid',
    'revealedwords',
    'currentclues',
    'visibleclues',
    'shuffledquestions',
]);

function isSecretKey(key) {
    const k = String(key).toLowerCase();
    if (SECRET_KEYS_EXACT.has(k)) return true;
    if (k.includes('password')) return true;
    if (k.startsWith('private')) return true;
    return false;
}

const MAX_JSON_DEPTH = 4;
const MAX_ARRAY_ITEMS = 8;
const MAX_STRING_LEN = 120;

function shortId(id) {
    if (!id) return '—';
    const s = String(id);
    return s.length <= 10 ? s : `${s.slice(0, 8)}…`;
}

function summarizeSubmitted(submitted, playersList) {
    if (!submitted || typeof submitted !== 'object') return 'brak mapy submitted';
    const nameById = new Map(
        (playersList || []).map((p) => [p.id, String(p.name || '').trim() || shortId(p.id)])
    );
    const entries = Object.entries(submitted);
    const done = [];
    const pending = [];
    for (const [pid, val] of entries) {
        const label = nameById.get(pid) || shortId(pid);
        if (val === true || val === 'true' || val === 1) done.push(label);
        else pending.push(label);
    }
    const extra = entries.length === 0 ? ' (pusta mapa)' : '';
    return `oddane: ${done.length ? done.join(', ') : '—'} | czeka: ${pending.length ? pending.join(', ') : '—'}${extra}`;
}

function sanitizeValue(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (depth > MAX_JSON_DEPTH) return '[…]';
    if (typeof value === 'string') {
        return value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}…` : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        if (value.length > MAX_ARRAY_ITEMS) {
            return `[tablica ×${value.length}, pierwsze: ${JSON.stringify(value.slice(0, 3))}]`;
        }
        return value.map((item) => sanitizeValue(item, depth + 1));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            if (isSecretKey(key)) {
                if (Array.isArray(val)) out[key] = `[ukryte ×${val.length}]`;
                else if (val && typeof val === 'object') out[key] = `[ukryte obiekt ×${Object.keys(val).length}]`;
                else out[key] = '[ukryte]';
            } else {
                out[key] = sanitizeValue(val, depth + 1);
            }
        }
        return out;
    }
    return String(value);
}

export function sanitizeGameStateForReport(gameState) {
    if (!gameState || typeof gameState !== 'object') return null;
    return sanitizeValue(gameState);
}

function describeDeckProgress(gameState) {
    const order = gameState?.order;
    const legacy = gameState?.shuffledQuestions;
    const idx = gameState?.currentQuestionIndex ?? gameState?.currentIndex;
    if (Array.isArray(order) && order.length > 0) {
        const i = Number(idx) || 0;
        return `pula kart: ${i + 1}/${order.length} (deck v${gameState.deckVersion ?? '?'})`;
    }
    if (Array.isArray(legacy) && legacy.length > 0) {
        const i = Number(idx) || 0;
        return `pula (legacy): ${i + 1}/${legacy.length}`;
    }
    return null;
}

function describeGameWaiting(gameId, gameState, playersList) {
    if (!gameState || typeof gameState !== 'object') {
        return 'Brak gameState w pokoju (lobby lub reset stołu).';
    }

    const parts = [];
    const phase = gameState.phase ?? (gameState.isGameStarted ? 'playing' : 'lobby');
    const started = gameState.isGameStarted === true || (phase && phase !== 'lobby');

    if (!started) {
        parts.push('Gra nie wystartowała — stoł czeka na start od hosta.');
        return parts.join(' ');
    }

    parts.push(`Faza: ${phase}`);

    if (gameState.roundNumber != null) {
        parts.push(`runda ${gameState.roundNumber}`);
    }

    const deck = describeDeckProgress(gameState);
    if (deck) parts.push(deck);

    if (gameState.submitted && typeof gameState.submitted === 'object') {
        parts.push(summarizeSubmitted(gameState.submitted, playersList));
    }

    if (gameState.awaitingNextRound === true) {
        parts.push('Czeka na hosta: ręczne przejście do następnej rundy (autoRound wyłączone lub koniec tury).');
    }

    switch (gameId) {
        case 'telepathy': {
            if (phase === 'submitting') {
                parts.push('Telepatia: gracze wpisują słowa (nieodsłonięte w raporcie).');
            } else if (phase === 'revealed') {
                if (shouldPauseForTelepathyNextRound(gameState)) {
                    parts.push('Telepatia: odsłonięto słowa — host może ruszyć kolejną rundę.');
                } else if (canAdvanceTelepathyRound(gameState)) {
                    parts.push('Telepatia: odsłonięcie — auto następna runda lub przycisk hosta.');
                }
            } else if (phase === 'won') {
                parts.push('Telepatia: wygrana — wszystkie słowa zgodne.');
            }
            break;
        }
        case 'just-one': {
            const listener = gameState.listenerId;
            if (listener) {
                const ln =
                    playersList?.find((p) => p.id === listener)?.name || shortId(listener);
                parts.push(`Just One: słuchacz — ${ln}`);
            }
            if (phase === 'peeking') parts.push('Just One: słuchacz ogląda hasło (ukryte w raporcie).');
            if (phase === 'submitting') parts.push('Just One: podpowiedzi od reszty stołu.');
            if (shouldPauseForJustOneNextRound(gameState)) {
                parts.push('Just One: host może przejść dalej (autoRound off lub pauza).');
            } else if (canAdvanceJustOneRound(gameState)) {
                parts.push('Just One: tura może być kontynuowana automatycznie lub przez hosta.');
            }
            break;
        }
        case 'impostor': {
            if (phase === 'peeking') parts.push('Impostor: gracze oglądają role (prywatne — nie w raporcie).');
            if (phase === 'discussing') parts.push('Impostor: dyskusja / głosowanie.');
            if (gameState.roundResult) parts.push(`Wynik rundy: ${gameState.roundResult}`);
            break;
        }
        case 'mafia': {
            if (phase === 'playing') parts.push('Mafia: rozgrywka w toku (role prywatne).');
            break;
        }
        default:
            break;
    }

    if (gameState.autoRound === false) {
        parts.push('autoRound: wyłączone (więcej kroków ręcznych).');
    }

    return parts.join(' · ');
}

function summarizeTablePlayers(playersList, myPlayerId, { isHost, effectiveIsHost, playerName, accountNickname }) {
    const list = Array.isArray(playersList) ? playersList : [];
    const hosts = list.filter((p) => p.isHost === true && p.isKicked !== true);
    const hostLabels = hosts.map(
        (p) => `${String(p.name || '?').trim() || '?'} [${shortId(p.id)}]${p.isOnline === false ? ' offline' : ''}`
    );

    const me = myPlayerId ? list.find((p) => p.id === myPlayerId) : null;
    const submitterNick = (playerName || accountNickname || me?.name || '').trim();

    const rosterLines = list
        .filter((p) => p.isKicked !== true)
        .map((p) => {
            const tags = [];
            if (p.isHost) tags.push('HOST');
            if (p.isGuest) tags.push('gość');
            if (p.isOnline === false) tags.push('offline');
            if (p.id === myPlayerId) tags.push('TY');
            return `  · ${String(p.name || '?').trim() || '?'} [${shortId(p.id)}] ${tags.join(', ') || 'gracz'}`;
        });

    return {
        hostLabel: hostLabels.length ? hostLabels.join('; ') : '— (brak hosta w liście)',
        submitterLabel: [
            submitterNick || '—',
            myPlayerId ? `id=${shortId(myPlayerId)}` : 'nie dołączono',
            isHost || effectiveIsHost ? 'rola=host' : 'rola=gość',
            me ? `w pokoju=${me.isOnline !== false ? 'online' : 'offline'}` : 'poza listą graczy',
        ].join(' · '),
        roster: rosterLines.length ? rosterLines.join('\n') : '  (pusty stół)',
        activeCount: list.filter((p) => p.isKicked !== true).length,
        guestCount: list.filter((p) => p.isGuest === true && p.isKicked !== true).length,
    };
}

function collectPerformanceEntries() {
    const entries = [];
    if (typeof performance === 'undefined') return entries;

    const mem = performance.memory;
    if (mem) {
        entries.push(['Pamięć JS (używane MB)', (mem.usedJSHeapSize / 1048576).toFixed(1)]);
        entries.push(['Pamięć JS (całkowite MB)', (mem.totalJSHeapSize / 1048576).toFixed(1)]);
        entries.push(['Limit sterty JS (MB)', (mem.jsHeapSizeLimit / 1048576).toFixed(1)]);
    }

    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
        entries.push(['Czas ładowania strony (ms)', String(Math.round(nav.duration || 0))]);
        if (nav.transferSize != null) {
            entries.push(['Transfer dokumentu (KB)', (nav.transferSize / 1024).toFixed(1)]);
        }
        if (nav.domInteractive) {
            entries.push(['DOM interactive (ms)', String(Math.round(nav.domInteractive))]);
        }
    }

    try {
        const resources = performance.getEntriesByType('resource');
        let totalTransfer = 0;
        let firebaseTransfer = 0;
        let counted = 0;
        for (const r of resources) {
            const size = r.transferSize || 0;
            if (!size) continue;
            totalTransfer += size;
            counted += 1;
            const name = String(r.name || '');
            if (
                name.includes('firebase') ||
                name.includes('googleapis') ||
                name.includes('firebasedatabase')
            ) {
                firebaseTransfer += size;
            }
        }
        entries.push(['Zasoby z transferem (liczba)', String(counted)]);
        entries.push(['Suma transferu zasobów (MB)', (totalTransfer / 1048576).toFixed(2)]);
        entries.push(['Transfer Firebase/Google (MB, szac.)', (firebaseTransfer / 1048576).toFixed(2)]);
    } catch {
        /* Performance API niedostępne */
    }

    return entries;
}

/**
 * Migawka diagnostyczna — wywoływana przy kopiowaniu / wysyłce (świeże dane z refs).
 */
export function buildBugReportDiagnostics({
    gameId,
    gameState,
    playersList,
    myPlayerId,
    isHost,
    effectiveIsHost,
    isJoined,
    playerName,
    accountNickname,
    roomId,
    pingMs,
    pingError,
    piQueueDepth,
    busyCount,
}) {
    const table = summarizeTablePlayers(playersList, myPlayerId, {
        isHost,
        effectiveIsHost,
        playerName,
        accountNickname,
    });

    const sanitizedState = sanitizeGameStateForReport(gameState);
    const waiting = describeGameWaiting(gameId, gameState, playersList);

    const tableEntries = [
        ['Kod pokoju', roomId || '—'],
        ['W grze (dołączony)', isJoined ? 'tak' : 'nie'],
        ['Host stołu', table.hostLabel],
        ['Zgłaszający', table.submitterLabel],
        ['Gracze przy stole', String(table.activeCount)],
        ['Goście (linked)', String(table.guestCount)],
        ['Skład stołu', `\n${table.roster}`],
    ];

    const gameEntries = [
        ['ID gry', gameId || '—'],
        ['Opis fazy / oczekiwania', waiting],
    ];
    if (sanitizedState) {
        gameEntries.push([
            'Stan gameState (oczyszczony)',
            JSON.stringify(sanitizedState, null, 2),
        ]);
    } else {
        gameEntries.push(['Stan gameState', '—']);
    }

    const runtimeEntries = [
        ['RTT ping RTDB (ms)', pingError ? 'błąd pomiaru' : pingMs != null ? String(pingMs) : 'nie mierzono'],
        ['Kolejka sync Pi (głębokość)', String(piQueueDepth ?? getPiQueueDepth())],
        ['Sesja gry Pi aktywna', isPiGameSessionActive() ? 'tak' : 'nie'],
        ['Operacje UI busy', String(busyCount ?? 0)],
        ['Tryb low-power', isLowPowerDevice() ? 'tak' : 'nie'],
        ...collectPerformanceEntries(),
    ];

    return {
        sections: [
            { title: 'Stół i gracze', entries: tableEntries },
            { title: 'Stan gry (faza, tura, oczekiwanie)', entries: gameEntries },
            { title: 'Wydajność i sieć (sesja)', entries: runtimeEntries },
        ],
    };
}

export function appendDiagnosticsToReportLines(lines, diagnostics) {
    if (!diagnostics?.sections?.length) return;
    for (const section of diagnostics.sections) {
        lines.push('');
        lines.push(`--- ${section.title} ---`);
        for (const [label, value] of section.entries) {
            if (value === null || value === undefined || value === '') continue;
            lines.push(`${label}: ${value}`);
        }
    }
}
