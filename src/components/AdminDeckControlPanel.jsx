import { useCallback, useMemo } from 'react';
import { ref } from 'firebase/database';
import { update } from '../lib/rtdb';
import { db } from '../lib/firebase';
import { useLocale } from '../locales/LocaleContext';
import {
    isAdminDeckPanelVisibleToPlayer,
    isShowPreviewVisibleToPlayer,
    isPuppetPanelVisibleToPlayer,
    canUsePuppetControls,
    isPuppetTurnGame,
} from '../lib/adminDeckControls';
import {
    buildSkipNextDeckQuestionUpdates,
    buildSkipTodNextPreviewUpdates,
} from '../lib/puppetDeckActions';
import { getActivePlayerNames } from '../lib/playerNames';

/**
 * Wspólny panel SHOW + PUPPET oraz akcje operatora.
 */
export default function AdminDeckControlPanel({
    visible: visibleProp,
    roomData,
    roomId,
    gameId,
    myPlayerId,
    tablePlayers = [],
    previewContent = null,
    contentByCategory = null,
    safeMode = false,
    deckSkipOptions = {},
    busy = false,
}) {
    const { t } = useLocale();

    const panelVisible = visibleProp ?? isAdminDeckPanelVisibleToPlayer(roomData, myPlayerId);
    const showPreview = isShowPreviewVisibleToPlayer(roomData, myPlayerId);
    const puppetMode = isPuppetPanelVisibleToPlayer(roomData, myPlayerId);
    const canControl = canUsePuppetControls(roomData, myPlayerId);
    const turnControlEnabled = isPuppetTurnGame(gameId);

    const activePlayerNames = useMemo(
        () => getActivePlayerNames(tablePlayers),
        [tablePlayers]
    );

    const currentTurnName = roomData?.currentPlayerName || '';
    const puppetNextName = roomData?.puppetNextPlayerName || '';

    const handlePickPlayer = useCallback(async (name) => {
        if (busy || !roomId) return;
        const trimmed = String(name || '').trim();
        if (!trimmed) return;
        await update(ref(db, `rooms/${roomId}/gameState`), {
            puppetNextPlayerName: trimmed,
        });
    }, [roomId, busy]);

    const handleRejectNext = useCallback(async () => {
        let updates = null;
        if (gameId === 'truth-or-dare' && contentByCategory) {
            updates = buildSkipTodNextPreviewUpdates(roomData, roomId, contentByCategory);
        } else {
            updates = buildSkipNextDeckQuestionUpdates(roomData, roomId, deckSkipOptions);
        }
        if (!updates) return;
        await update(ref(db), updates);
    }, [gameId, contentByCategory, roomData, roomId, deckSkipOptions]);

    if (!panelVisible) return null;

    const panelTitle = showPreview && puppetMode
        ? t('gameUi.adminDeckPanelTitleBoth')
        : puppetMode
            ? t('gameUi.adminDeckPanelTitlePuppet')
            : t('gameUi.showNextPreviewTitle');

    const canRejectNext = gameId === 'truth-or-dare'
        ? Boolean(contentByCategory)
        : true;

    return (
        <section className="admin-next-preview admin-deck-control" aria-live="polite">
            <p className="admin-next-preview__title">{panelTitle}</p>
            <div className="content-panel content-panel--dark admin-next-preview__panel">
                {showPreview && (
                    <div className="admin-deck-control__preview">
                        {previewContent}
                    </div>
                )}

                {puppetMode && canControl && (
                    <div className={`admin-deck-control__puppet ${showPreview ? 'admin-deck-control__puppet--split' : ''}`}>
                        {turnControlEnabled && (
                            <div className="admin-deck-control__turn">
                                <p className="admin-deck-control__label">{t('gameUi.puppetAssignTurn')}</p>
                                {activePlayerNames.length === 0 ? (
                                    <p className="admin-deck-control__empty">{t('gameUi.puppetNoPlayers')}</p>
                                ) : (
                                    <div
                                        className="admin-deck-control__player-picker"
                                        role="group"
                                        aria-label={t('gameUi.puppetAssignTurn')}
                                    >
                                        {activePlayerNames.map((name) => (
                                            <button
                                                key={name}
                                                type="button"
                                                className={`admin-deck-control__player-chip ${
                                                    puppetNextName === name
                                                        ? 'admin-deck-control__player-chip--active'
                                                        : ''
                                                } ${
                                                    currentTurnName === name
                                                        ? 'admin-deck-control__player-chip--current'
                                                        : ''
                                                }`}
                                                onClick={() => handlePickPlayer(name)}
                                                disabled={busy}
                                                aria-pressed={puppetNextName === name}
                                                title={
                                                    currentTurnName === name
                                                        ? t('gameUi.puppetCurrentTurnHint')
                                                        : undefined
                                                }
                                            >
                                                {name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="admin-deck-control__reject">
                            <button
                                type="button"
                                className="btn-confirm-base admin-deck-control__btn admin-deck-control__btn--reject"
                                onClick={handleRejectNext}
                                disabled={busy || !canRejectNext}
                            >
                                {t('gameUi.puppetRejectNext')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
