import fs from 'fs';

const app = fs.readFileSync('src/app/App.jsx', 'utf8');
const lines = app.split(/\r?\n/);

function slice(startLine, endLine) {
    return lines.slice(startLine - 1, endLine).join('\n');
}

const chunks = [
    slice(398, 460),
    slice(843, 981),
    slice(984, 1229),
    slice(1231, 1303),
    slice(1309, 1322),
    slice(1324, 1423),
    slice(1429, 1609),
];

const header = `import { useCallback, useEffect, useMemo } from 'react';
import { ref, push, remove, onValue, onDisconnect } from 'firebase/database';
import { set, get, update } from '../../lib/rtdb';
import { db } from '../../lib/firebase';
import {
    buildRoomPublicEntry,
    roomDeleteUpdates,
    roomPublicPath,
} from '../../lib/roomIndex';
import {
    normalizeJoinMode,
    normalizeAdmission,
    cycleAdmission,
    needsPasswordFromList,
    needsApprovalToJoin,
    isRoomClosedForNewPlayers,
    canJoinFromList,
    defaultShowCodeInList,
    showRoomCodeInList,
} from '../../lib/roomAccess';
import {
    hashRoomPassword,
    verifyRoomPassword,
    isValidRoomPassword,
    MIN_ROOM_PASSWORD_LENGTH,
    MAX_ROOM_PASSWORD_LENGTH,
} from '../../lib/roomPassword';
import { isGameCreationEnabled, isGameJoinEnabled } from '../../lib/cmsConfig.js';
import { getComingSoonMessage, isGameComingSoon } from '../../lib/gameCatalog.js';
import { resolveGameId, isPlayableGameId } from '../../data/gameIds.js';
import { prefetchGameChunk } from '../../lib/prefetchGameChunk';
import { getJoinGraceMs } from '../../lib/lowPower';
import { recordRoomCreated, recordNewPlayerJoin } from '../../lib/appMetrics.js';
import {
    buildTelepathySyncUpdates,
    buildJustOneSyncUpdates,
} from '../../lib/telepathyState';
import { PRESENCE_INDEX_ROOT, RATE_LIMITS_MS, LAST_ROOM_KEY } from '../constants';

export function useRoomLifecycle(deps) {
    const {
        accountNickname,
        authUser,
        cachedRoomRef,
        cmsConfig,
        gameContent,
        isHost,
        isJoined,
        myPlayerId,
        myJoinRequestId,
        playerName,
        roomAdmission,
        roomShowCodeInList,
        selectedGame,
        selectedGameType,
        guestRoomPassword,
        guestJoinViaInvite,
        guestPasswordGranted,
        joinRequestList,
        waitingForApproval,
        currentRoomJoinMode,
        lastKnownRoomId,
        effectiveIsHost,
        roomInviteUrl,
        isLeavingVoluntarily,
        isJoiningRef,
        isJoinedRef,
        myPlayerIdRef,
        joinGraceUntilRef,
        missingPlayerSinceRef,
        pendingJoinCountRef,
        showCodeInListRef,
        lastPlayersListFingerprintRef,
        lastPublicSyncFingerprintRef,
        isRateLimited,
        isAdminRateLimited,
        setSelectedGame,
        setSelectedGameType,
        setIsJoined,
        setIsHost,
        setMyPlayerId,
        setPlayersList,
        setNameError,
        setJoinStatus,
        setLastJoinResult,
        setGuestRoomPassword,
        setGuestPasswordError,
        setGuestPasswordGranted,
        setGuestJoinViaInvite,
        setCurrentRoomJoinMode,
        setRoomAdmission,
        setRoomShowCodeInList,
        setJoinRequestList,
        setWaitingForApproval,
        setMyJoinRequestId,
        setIsRoomLocked,
        setPlayerName,
        setLobbyMessage,
        setEntryRole,
        setHostRoomPassword,
        setShowAdminPanel,
        setShowAccountCenter,
        setAuthStatus,
        setLastKnownRoomId,
        runWithBusy,
        t,
    } = deps;

`;

const footer = `
    return {
        leaveToLobby,
        updatePresenceIndex,
        clearPresenceIndex,
        completeGuestJoin,
        approveJoinRequest,
        rejectJoinRequest,
        approveAllJoinRequests,
        cycleRoomAdmission,
        toggleShowCodeInList,
        hostShareOptions,
        handleJoin,
        openRoomAsGuest,
        handleGuestRoomPassword,
        handleJoinLastKnownGame,
        createHostRoom,
        kickPlayer,
        adminKick,
        adminDeleteRoom,
        handleBackToMenu,
        handleCloseRoom,
        handleLeaveRoom,
    };
}
`;

fs.writeFileSync('src/app/hooks/useRoomLifecycle.js', header + chunks.join('\n\n') + footer);
console.log('ok', chunks.join('\n\n').split('\n').length, 'body lines');
