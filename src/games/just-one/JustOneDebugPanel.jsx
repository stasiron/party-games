import { useMemo, useState } from 'react';
import {
    filterJustOneRequiredClueGivers,
    isJustOneClueSubmitted,
} from './justOneUtils';

const DEBUG_STORAGE_KEY = 'partyGames.justOneDebug';

export function isJustOneDebugEnabled() {
    if (import.meta.env.DEV) return true;
    try {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('justOneDebug') === '1') return true;
        }
        return localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function BoolChip({ label, value, warn = false }) {
    return (
        <span
            className={`just-one-debug__chip ${value ? 'just-one-debug__chip--on' : 'just-one-debug__chip--off'} ${warn ? 'just-one-debug__chip--warn' : ''}`}
        >
            <span className="just-one-debug__chip-label">{label}</span>
            <span className="just-one-debug__chip-value">{value ? 'TAK' : 'NIE'}</span>
        </span>
    );
}

function FlowStep({ title, active, done, detail }) {
    return (
        <div
            className={`just-one-debug__flow-step ${active ? 'just-one-debug__flow-step--active' : ''} ${done ? 'just-one-debug__flow-step--done' : ''}`}
        >
            <div className="just-one-debug__flow-dot" />
            <div className="just-one-debug__flow-text">
                <strong>{title}</strong>
                {detail ? <span>{detail}</span> : null}
            </div>
        </div>
    );
}

/**
 * @param {object} props
 */
export default function JustOneDebugPanel({
    myPlayerId,
    isHost,
    roomData,
    listenerId,
    participantIds,
    clueGiverIds,
    tablePlayersList,
    submitted,
    listenerOutOfSync,
    listenerName,
    iAmListener,
    iAmClueGiver,
    playersICanSubmitFor,
    iAmFullySubmitted,
    everyoneSubmitted,
    pendingCount,
    pendingNames,
    participantsFingerprint,
    effectStats,
    isSubmitting,
    roundNumber,
}) {
    const [open, setOpen] = useState(true);
    const [showJson, setShowJson] = useState(false);

    const requiredClueGiverIds = useMemo(
        () => filterJustOneRequiredClueGivers(tablePlayersList, clueGiverIds, listenerId),
        [tablePlayersList, clueGiverIds, listenerId]
    );

    const analysis = useMemo(() => {
        const requiredSubmitted = requiredClueGiverIds.filter((id) =>
            isJustOneClueSubmitted(submitted, id, listenerId)
        );
        const requiredPending = requiredClueGiverIds.filter(
            (id) => !isJustOneClueSubmitted(submitted, id, listenerId)
        );
        const listenerInClueGivers = Boolean(listenerId && clueGiverIds.includes(listenerId));
        const listenerMarkedSubmitted = listenerId
            ? isJustOneClueSubmitted(submitted, listenerId, listenerId)
            : false;
        const orphanSubmittedKeys = Object.keys(submitted || {}).filter(
            (id) => !clueGiverIds.includes(id) && id !== listenerId
        );
        const progressPct =
            requiredClueGiverIds.length === 0
                ? 100
                : Math.round((requiredSubmitted.length / requiredClueGiverIds.length) * 100);

        const playerCards = tablePlayersList.map((p) => {
            const isListener = p.id === listenerId;
            const isClue = clueGiverIds.includes(p.id);
            const isRequired = requiredClueGiverIds.includes(p.id);
            const isSubmitted = isJustOneClueSubmitted(submitted, p.id, listenerId);
            let status = 'poza turą';
            if (isListener) status = 'nasłuchiwacz (auto ✓)';
            else if (isRequired && isSubmitted) status = 'oddane';
            else if (isRequired) status = 'CZEKA';
            else if (isClue) status = 'podawca (pominięty)';
            return {
                ...p,
                isListener,
                isClue,
                isRequired,
                isSubmitted,
                isMe: p.id === myPlayerId,
                status,
            };
        });

        return {
            requiredSubmitted,
            requiredPending,
            listenerInClueGivers,
            listenerMarkedSubmitted,
            orphanSubmittedKeys,
            progressPct,
            playerCards,
            shouldReveal: everyoneSubmitted && isSubmitting && clueGiverIds.length > 0,
            shouldShowWaitOthers:
                playersICanSubmitFor.length > 0
                && iAmFullySubmitted
                && pendingCount > 0
                && Boolean(pendingNames),
        };
    }, [
        requiredClueGiverIds,
        submitted,
        listenerId,
        clueGiverIds,
        tablePlayersList,
        myPlayerId,
        everyoneSubmitted,
        isSubmitting,
        playersICanSubmitFor,
        iAmFullySubmitted,
        pendingCount,
        pendingNames,
    ]);

    const snapshot = useMemo(
        () => ({
            effectStats,
            phase: roomData.phase,
            roundNumber,
            listener: {
                rtdb: roomData.listenerId,
                resolved: listenerId,
                name: listenerName,
                outOfSync: listenerOutOfSync,
                inClueGivers: analysis.listenerInClueGivers,
                markedSubmitted: analysis.listenerMarkedSubmitted,
            },
            counts: {
                participants: participantIds.length,
                clueGivers: clueGiverIds.length,
                required: requiredClueGiverIds.length,
                submittedRequired: analysis.requiredSubmitted.length,
                pending: analysis.requiredPending.length,
            },
            ids: {
                participantIds,
                clueGiverIds,
                requiredClueGiverIds,
                pendingIds: analysis.requiredPending,
                orphanSubmittedKeys: analysis.orphanSubmittedKeys,
            },
            submitted,
            flags: {
                everyoneSubmitted,
                iAmFullySubmitted,
                iAmListener,
                iAmClueGiver,
                isHost,
                shouldReveal: analysis.shouldReveal,
                shouldShowWaitOthers: analysis.shouldShowWaitOthers,
            },
            playersICanSubmitFor,
            participantsFingerprint,
        }),
        [
            effectStats,
            roomData,
            roundNumber,
            listenerId,
            listenerName,
            listenerOutOfSync,
            analysis,
            participantIds,
            clueGiverIds,
            requiredClueGiverIds,
            submitted,
            everyoneSubmitted,
            iAmFullySubmitted,
            iAmListener,
            iAmClueGiver,
            isHost,
            playersICanSubmitFor,
            participantsFingerprint,
        ]
    );

    if (!isJustOneDebugEnabled()) return null;

    return (
        <aside className="just-one-debug" aria-label="Just One debug">
            <button
                type="button"
                className="just-one-debug__toggle"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                {open ? '▼' : '▶'} Just One — panel debug
            </button>

            {open ? (
                <div className="just-one-debug__body">
                    <div className="just-one-debug__grid just-one-debug__grid--stats">
                        <div className="just-one-debug__stat-card">
                            <span className="just-one-debug__stat-label">Faza</span>
                            <strong>{roomData.phase || '—'}</strong>
                            <span className="just-one-debug__stat-sub">Tura {roundNumber || 0}</span>
                        </div>
                        <div className="just-one-debug__stat-card">
                            <span className="just-one-debug__stat-label">Postęp wymaganych</span>
                            <strong>
                                {analysis.requiredSubmitted.length}/{requiredClueGiverIds.length}
                            </strong>
                            <div className="just-one-debug__progress">
                                <div
                                    className="just-one-debug__progress-fill"
                                    style={{ width: `${analysis.progressPct}%` }}
                                />
                            </div>
                        </div>
                        <div className="just-one-debug__stat-card">
                            <span className="just-one-debug__stat-label">Advance (tura)</span>
                            <strong>{effectStats?.advanceAttempts ?? 0}×</strong>
                            <span className="just-one-debug__stat-sub">
                                {effectStats?.lastAdvanceResult ?? '—'}
                            </span>
                        </div>
                        <div className="just-one-debug__stat-card">
                            <span className="just-one-debug__stat-label">Host sync</span>
                            <strong>{effectStats?.hostSyncRuns ?? 0}×</strong>
                            <span className="just-one-debug__stat-sub">
                                {effectStats?.lastSyncResult ?? '—'}
                            </span>
                        </div>
                        <div className="just-one-debug__stat-card">
                            <span className="just-one-debug__stat-label">Sync listener</span>
                            <strong>{effectStats?.listenerSyncRuns ?? 0}×</strong>
                            <span className="just-one-debug__stat-sub">
                                {listenerOutOfSync ? '⚠ desync RTDB' : 'OK'}
                            </span>
                        </div>
                    </div>

                    <div className="just-one-debug__chips">
                        <BoolChip label="Wszyscy oddali" value={everyoneSubmitted} />
                        <BoolChip label="Ja oddałem" value={iAmFullySubmitted} />
                        <BoolChip label="Ja słucham" value={iAmListener} />
                        <BoolChip label="Ja podaję" value={iAmClueGiver} />
                        <BoolChip label="Host" value={isHost} />
                        <BoolChip
                            label="Listener w clueGivers"
                            value={analysis.listenerInClueGivers}
                            warn={analysis.listenerInClueGivers}
                        />
                        <BoolChip
                            label="Listener submitted"
                            value={analysis.listenerMarkedSubmitted}
                        />
                        <BoolChip label="UI: czekaj na innych" value={analysis.shouldShowWaitOthers} />
                        <BoolChip label="Powinno przejść dalej" value={analysis.shouldReveal} />
                        <BoolChip
                            label="Ostatni advance OK"
                            value={effectStats?.lastAdvanceResult === 'revealed'}
                            warn={effectStats?.lastAdvanceResult?.startsWith('pending')}
                        />
                    </div>

                    <div className="just-one-debug__section">
                        <h4 className="just-one-debug__section-title">Nasłuchiwacz</h4>
                        <div className="just-one-debug__listener-box">
                            <div>
                                <small>RTDB</small>
                                <code>{roomData.listenerId || '—'}</code>
                            </div>
                            <span className="just-one-debug__arrow">→</span>
                            <div>
                                <small>Wyliczony</small>
                                <code>{listenerId || '—'}</code>
                            </div>
                            <div className="just-one-debug__listener-name">
                                {listenerName || '?'}
                            </div>
                        </div>
                    </div>

                    <div className="just-one-debug__section">
                        <h4 className="just-one-debug__section-title">Przepływ tury</h4>
                        <div className="just-one-debug__flow">
                            <FlowStep
                                title="Faza: wpisywanie"
                                active={isSubmitting}
                                done={!isSubmitting}
                                detail={roomData.phase}
                            />
                            <FlowStep
                                title="Wszyscy wymagani oddali"
                                active={isSubmitting && !everyoneSubmitted}
                                done={everyoneSubmitted}
                                detail={`${analysis.requiredSubmitted.length}/${requiredClueGiverIds.length}`}
                            />
                            <FlowStep
                                title="tryAdvance → reveal"
                                active={analysis.shouldReveal}
                                done={effectStats?.lastAdvanceResult === 'revealed'}
                                detail={effectStats?.lastAdvanceResult}
                            />
                            <FlowStep
                                title="Host SYNC (porządki)"
                                active={isHost && isSubmitting}
                                done={false}
                                detail={effectStats?.lastSyncResult}
                            />
                        </div>
                    </div>

                    {analysis.requiredPending.length > 0 ? (
                        <div className="just-one-debug__alert just-one-debug__alert--warn">
                            <strong>Brakuje podpowiedzi od:</strong>
                            <ul>
                                {analysis.requiredPending.map((id) => {
                                    const p = tablePlayersList.find((x) => x.id === id);
                                    return (
                                        <li key={id}>
                                            {p?.name || '?'} <code>{id}</code>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ) : (
                        <div className="just-one-debug__alert just-one-debug__alert--ok">
                            Brak oczekujących wymaganych podawców
                        </div>
                    )}

                    {analysis.orphanSubmittedKeys.length > 0 ? (
                        <div className="just-one-debug__alert just-one-debug__alert--warn">
                            <strong>Osierocone klucze submitted</strong> (nie clue giver):{' '}
                            {analysis.orphanSubmittedKeys.join(', ')}
                        </div>
                    ) : null}

                    <div className="just-one-debug__section">
                        <h4 className="just-one-debug__section-title">Gracze przy stole</h4>
                        <div className="just-one-debug__player-grid">
                            {analysis.playerCards.map((p) => (
                                <div
                                    key={p.id}
                                    className={`just-one-debug__player-card just-one-debug__player-card--${p.isListener ? 'listener' : p.isRequired && !p.isSubmitted ? 'pending' : p.isSubmitted ? 'done' : 'idle'} ${p.isMe ? 'just-one-debug__player-card--me' : ''}`}
                                >
                                    <div className="just-one-debug__player-card-head">
                                        <span className="just-one-debug__player-name">
                                            {p.name}
                                            {p.isMe ? ' (ty)' : ''}
                                        </span>
                                        {p.isGuest ? <span className="just-one-debug__badge">G</span> : null}
                                        {!p.isOnline && p.isOnline !== undefined ? (
                                            <span className="just-one-debug__badge just-one-debug__badge--off">
                                                off
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="just-one-debug__player-status">{p.status}</div>
                                    <code className="just-one-debug__player-id">{p.id}</code>
                                    {p.linkedToPlayerId ? (
                                        <small className="just-one-debug__player-owner">
                                            tel. właściciela: {p.linkedToPlayerId.slice(0, 8)}…
                                        </small>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="just-one-debug__section">
                        <h4 className="just-one-debug__section-title">Listy ID</h4>
                        <div className="just-one-debug__lists">
                            <div>
                                <small>clueGiverIds ({clueGiverIds.length})</small>
                                <code>{clueGiverIds.join(', ') || '—'}</code>
                            </div>
                            <div>
                                <small>required ({requiredClueGiverIds.length})</small>
                                <code>{requiredClueGiverIds.join(', ') || '—'}</code>
                            </div>
                            <div>
                                <small>mogę wysłać za</small>
                                <code>
                                    {playersICanSubmitFor.map((x) => x.name).join(', ') || '—'}
                                </code>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="just-one-debug__json-toggle"
                        onClick={() => setShowJson((v) => !v)}
                    >
                        {showJson ? 'Ukryj' : 'Pokaż'} pełny JSON
                    </button>
                    {showJson ? (
                        <pre className="just-one-debug__json">{JSON.stringify(snapshot, null, 2)}</pre>
                    ) : null}
                </div>
            ) : null}
        </aside>
    );
}
