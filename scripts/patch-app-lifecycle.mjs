import fs from 'fs';

const path = 'src/app/App.jsx';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

function removeRange(start, end) {
    lines.splice(start - 1, end - start + 1);
}

removeRange(1429, 1609);
removeRange(1324, 1423);
removeRange(1309, 1322);
removeRange(1231, 1307);
removeRange(984, 1229);
removeRange(843, 981);
removeRange(398, 460);

const importLine = "import { useRoomLifecycle } from './hooks/useRoomLifecycle';";
if (!lines.some((l) => l.includes('useRoomLifecycle'))) {
    const adminImportIdx = lines.findIndex((l) => l.includes("import { useAdminCommands }"));
    lines.splice(adminImportIdx + 1, 0, importLine);
}

const hookCall = `    const {
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
    } = useRoomLifecycle({
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
    });

    useEffect(() => {
        openRoomAsGuestRef.current = openRoomAsGuest;
    }, [openRoomAsGuest]);

    useEffect(() => {
        createHostRoomRef.current = createHostRoom;
    }, [createHostRoom]);
`;

const adminIdx = lines.findIndex((l) => l.includes('const { handleAdminCommand } = useAdminCommands'));
lines.splice(adminIdx, 0, hookCall);

fs.writeFileSync(path, lines.join('\n'));
console.log('patched App.jsx, lines:', lines.length);
