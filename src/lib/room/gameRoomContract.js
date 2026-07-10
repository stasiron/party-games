/**
 * Jedno źródło prawdy: pokój w grze — profile, etykiety, uprawnienia, lobby.
 *
 * Dokumentacja:
 * - Ludzie: docs/ROOM_MODEL.md
 * - AI / agenci: docs/ROOM_MODEL_AI.md (czytaj przed edycją tego pliku lub lifecycle)
 */

export const ROOM_UI_LABEL_KEYS = {
    closeRoom: 'gameUi.closeRoom',
    leaveRoom: 'gameUi.leaveRoom',
    resetTable: 'gameUi.resetTable',
    resetRoundImpostor: 'gameUi.resetRoundImpostor',
    resetRoundTopTen: 'gameUi.resetRoundTopTen',
    resetRoundMafia: 'gameUi.resetRoundMafia',
};

const DEFAULT_GAME_ROOM = {
    adminCanManageRoom: false,
    hostExitLabelKey: ROOM_UI_LABEL_KEYS.closeRoom,
    guestExitLabelKey: ROOM_UI_LABEL_KEYS.leaveRoom,
    resetRoundLabelKey: ROOM_UI_LABEL_KEYS.resetTable,
    resetBeforeClose: true,
    lobbyWaitLabelKey: 'gameLobby.waitForHost',
    needsSharedPhoneTurn: false,
    adminDeckControls: false,
    puppetTurnGame: false,
    puppetSkipOnly: false,
    kickSyncKind: null,
};

/** Wyjątki per gra — tylko pola różniące się od DEFAULT. */
const GAME_ROOM_BY_ID = {
    'never-have-i-ever': {
        adminDeckControls: true,
        puppetSkipOnly: true,
    },
    'truth-or-dare': {
        adminDeckControls: true,
        puppetTurnGame: true,
        needsSharedPhoneTurn: true,
        lobbyWaitLabelKey: 'gameLobby.waitForHostDeck',
    },
    'who-would-rather': {
        adminDeckControls: true,
        puppetTurnGame: true,
        needsSharedPhoneTurn: true,
    },
    'kto-najpredzej': {
        adminDeckControls: true,
        puppetSkipOnly: true,
    },
    'dark-stories': {
        lobbyWaitLabelKey: 'gameLobby.waitForHostNarrator',
    },
    impostor: {
        resetRoundLabelKey: ROOM_UI_LABEL_KEYS.resetRoundImpostor,
        lobbyWaitLabelKey: 'gameLobby.waitForHostImpostor',
    },
    mafia: {
        resetRoundLabelKey: ROOM_UI_LABEL_KEYS.resetRoundMafia,
        resetBeforeClose: false,
    },
    telepathy: {
        lobbyWaitLabelKey: 'gameLobby.waitForHostTelepathy',
        kickSyncKind: 'telepathy',
    },
    'just-one': {
        lobbyWaitLabelKey: 'gameLobby.waitForHostJustOne',
        kickSyncKind: 'just-one',
    },
    'sing-it': {
        lobbyWaitLabelKey: 'gameLobby.waitForHostSingIt',
    },
    'top-ten': {
        adminCanManageRoom: true,
        resetRoundLabelKey: ROOM_UI_LABEL_KEYS.resetRoundTopTen,
        lobbyWaitLabelKey: 'gameLobby.waitForHostTopTen',
    },
};

export function getGameRoomProfile(gameId) {
    return { ...DEFAULT_GAME_ROOM, ...(GAME_ROOM_BY_ID[gameId] || {}) };
}

export function resolveCanManageRoom({ gameId, effectiveIsHost, hasAdminPowers }) {
    if (effectiveIsHost) return true;
    const profile = getGameRoomProfile(gameId);
    return profile.adminCanManageRoom === true && hasAdminPowers === true;
}

export function resolveCanCloseRoom(params) {
    return resolveCanManageRoom(params);
}

export function getRoomExitLabels(t, gameId, canManageRoom) {
    const profile = getGameRoomProfile(gameId);
    return {
        exit: canManageRoom
            ? t(profile.hostExitLabelKey)
            : t(profile.guestExitLabelKey),
        resetRound: t(profile.resetRoundLabelKey),
    };
}

export function getLobbyWaitMessage(t, gameId) {
    const profile = getGameRoomProfile(gameId);
    return t(profile.lobbyWaitLabelKey);
}

export function shouldResetBeforeClose(gameId) {
    return getGameRoomProfile(gameId).resetBeforeClose !== false;
}

export function gameNeedsSharedPhoneTurn(gameId) {
    return getGameRoomProfile(gameId).needsSharedPhoneTurn === true;
}

export function gameUsesAdminDeckControls(gameId) {
    return getGameRoomProfile(gameId).adminDeckControls === true;
}

export function gameUsesPuppetTurn(gameId) {
    return getGameRoomProfile(gameId).puppetTurnGame === true;
}

export function gameUsesPuppetSkipOnly(gameId) {
    return getGameRoomProfile(gameId).puppetSkipOnly === true;
}

export function getKickSyncKind(gameId) {
    return getGameRoomProfile(gameId).kickSyncKind || null;
}

export function buildGameRoomProps({
    roomId,
    gameId,
    effectiveIsHost,
    hasAdminPowers,
    handleLeaveRoom,
    myPlayerId,
    tablePlayers,
    playerName,
    hostShareOptions,
    isRoomLocked,
    vibrationEnabled,
}) {
    const canManageRoom = resolveCanManageRoom({
        gameId,
        effectiveIsHost,
        hasAdminPowers,
    });

    return {
        roomId,
        gameId,
        isHost: effectiveIsHost,
        canManageRoom,
        onLeave: handleLeaveRoom,
        myPlayerId,
        tablePlayers,
        playerName: gameNeedsSharedPhoneTurn(gameId) ? playerName : undefined,
        shareOptions: hostShareOptions,
        isRoomLocked,
        hasAdminPowers,
        vibrationEnabled,
    };
}
