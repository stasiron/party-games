import { memo, useMemo } from 'react';
import JoinRequestPanel from '../components/JoinRequestPanel';
import RoomInviteQR from '../components/RoomInviteQR';
import GuestPlayersPanel from '../components/GuestPlayersPanel';
import { RoomPlayersProvider } from '../context/RoomPlayersContext';
import GameRouter from './GameRouter';
import { getAdmissionOption, getJoinModeOptions } from '../lib/roomAccessLabels';
import { isGuestPlayer } from '../lib/guestPlayers';
import {
    MIN_ROOM_PASSWORD_LENGTH,
    MAX_ROOM_PASSWORD_LENGTH,
} from '../lib/roomPassword';
import { useLocale } from '../locales/LocaleContext';

function RoomScreen({
    selectedGame,
    selectedGameType,
    currentGameMeta,
    effectiveIsHost,
    isHost,
    isJoined,
    roomAdmission,
    joinRequestList,
    cycleRoomAdmission,
    approveJoinRequest,
    rejectJoinRequest,
    approveAllJoinRequests,
    waitingForApproval,
    currentRoomJoinMode,
    guestPasswordGranted,
    guestRoomPassword,
    setGuestRoomPassword,
    guestPasswordError,
    setGuestPasswordError,
    handleGuestRoomPassword,
    guestJoinViaInvite,
    playerName,
    setPlayerName,
    nameError,
    setNameError,
    joinStatus,
    lastJoinResult,
    handleJoin,
    handleBackToMenu,
    roomInviteUrl,
    roomShowCodeInList,
    toggleShowCodeInList,
    handleLeaveRoom,
    handleCloseRoom,
    myPlayerId,
    vibrationEnabled,
    isRoomLocked,
    hostShareOptions,
    playersList,
    runWithBusy,
    kickPlayer,
    hasAdminPowers,
    adminKick,
}) {
    const { t } = useLocale();
    const joinModeOptions = useMemo(() => getJoinModeOptions(t), [t]);
    const admissionOption = getAdmissionOption(roomAdmission, t);
    const joinModeLabel = joinModeOptions.find((o) => o.id === currentRoomJoinMode)?.label || '—';

    if (!selectedGameType) {
        return (
            <div className="content-panel content-panel--dark">
                <p>{t('common.loadingRoom')}</p>
                <div className="actions-stack">
                    <button type="button" onClick={handleBackToMenu} className="btn-link">{t('common.back')}</button>
                </div>
            </div>
        );
    }

    const content = (
        <>
            {effectiveIsHost && (
                <>
                    <JoinRequestPanel
                        requests={joinRequestList}
                        onApprove={approveJoinRequest}
                        onReject={rejectJoinRequest}
                        onApproveAll={approveAllJoinRequests}
                    />
                    <div className="room-lock-container">
                        <button
                            type="button"
                            onClick={cycleRoomAdmission}
                            className={`btn-lock-toggle ${admissionOption.buttonClass}`}
                        >
                            {admissionOption.icon}{' '}
                            {admissionOption.label}
                            {joinRequestList.length > 0
                                ? ` ${t('admission.waitingCount', { count: joinRequestList.length })}`
                                : ''}
                            {' '}{t('admission.clickToChange')}
                        </button>
                        <p className="room-admission-hint">
                            {admissionOption.desc}
                        </p>
                    </div>
                </>
            )}

            {!isJoined ? (
                waitingForApproval ? (
                    <div>
                        <h2>{t('room.title', { name: currentGameMeta?.name ?? '' })}</h2>
                        <p className="join-progress join-waiting-host">
                            {t('room.waitingApproval')}
                        </p>
                        <p>{t('room.waitingApprovalHint')}</p>
                        <div className="actions-stack">
                            <button type="button" onClick={handleBackToMenu} className="btn-link">{t('room.cancelRequest')}</button>
                        </div>
                    </div>
                ) : !isHost && currentRoomJoinMode === 'password' && !guestPasswordGranted ? (
                    <div>
                        <h2>{t('room.title', { name: currentGameMeta?.name ?? '' })}</h2>
                        <p>{t('room.passwordRequired')}</p>
                        <input
                            type="password"
                            value={guestRoomPassword}
                            onChange={(e) => {
                                setGuestRoomPassword(e.target.value);
                                setGuestPasswordError('');
                            }}
                            placeholder={t('room.passwordPlaceholder', {
                                min: MIN_ROOM_PASSWORD_LENGTH,
                                max: MAX_ROOM_PASSWORD_LENGTH,
                            })}
                            maxLength={MAX_ROOM_PASSWORD_LENGTH}
                            autoComplete="current-password"
                            onKeyDown={(e) => e.key === 'Enter' && handleGuestRoomPassword()}
                            className={guestPasswordError ? 'input-error' : ''}
                        />
                        {guestPasswordError && <p className="error-message">{guestPasswordError}</p>}
                        <div className="actions-stack">
                            <button
                                type="button"
                                onClick={handleGuestRoomPassword}
                                disabled={guestRoomPassword.trim().length < MIN_ROOM_PASSWORD_LENGTH}
                            >
                                {t('common.continue')}
                            </button>
                            <button type="button" onClick={handleBackToMenu} className="btn-link">{t('common.back')}</button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <h2>{t('room.title', { name: currentGameMeta?.name ?? '' })}</h2>
                        {isHost && (
                            <p className="join-progress">
                                {t('room.hostMode', {
                                    joinMode: joinModeLabel,
                                    admission: admissionOption.label,
                                })}
                            </p>
                        )}
                        {!isHost && guestJoinViaInvite && (
                            <p className="join-progress">{t('room.inviteSkipQueue')}</p>
                        )}
                        <p>{t('room.enterName')}</p>
                        <input
                            type="text"
                            value={playerName}
                            onChange={(e) => {
                                setPlayerName(e.target.value);
                                setNameError('');
                            }}
                            placeholder={t('room.namePlaceholder')}
                            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                            className={nameError ? 'input-error' : ''}
                            required
                            aria-invalid={nameError ? 'true' : 'false'}
                        />

                        {nameError && <p className="error-message">{nameError}</p>}
                        {joinStatus && <p className="join-progress">{joinStatus}</p>}
                        {lastJoinResult && !nameError && <p className="join-progress">{lastJoinResult}</p>}

                        {isHost && (
                            <RoomInviteQR
                                inviteUrl={roomInviteUrl}
                                roomId={selectedGame}
                                showCodeInList={roomShowCodeInList}
                                onToggleShowCodeInList={toggleShowCodeInList}
                                className="room-invite--slot"
                            />
                        )}

                        <div className="actions-stack">
                            <button type="button" onClick={handleJoin} disabled={playerName.trim() === ''}>{t('room.join')}</button>
                            <button type="button" onClick={handleBackToMenu} className="btn-link">{t('common.back')}</button>
                        </div>
                    </div>
                )
            ) : (
                <div>
                    <h2>{t('room.playing', { name: currentGameMeta?.name ?? '' })}</h2>
                    <GameRouter
                        selectedGameType={selectedGameType}
                        currentGameMeta={currentGameMeta}
                        effectiveIsHost={effectiveIsHost}
                        handleLeaveRoom={handleLeaveRoom}
                        handleCloseRoom={handleCloseRoom}
                        playerName={playerName}
                        myPlayerId={myPlayerId}
                        vibrationEnabled={vibrationEnabled}
                        isRoomLocked={isRoomLocked}
                        roomId={selectedGame}
                        hostShareOptions={hostShareOptions}
                    />
                </div>
            )}

            {isJoined && effectiveIsHost && (
                <GuestPlayersPanel
                    roomId={selectedGame}
                    playersList={playersList}
                    myPlayerId={myPlayerId}
                    runWithBusy={runWithBusy}
                />
            )}

            <div className="players-section">
                <h3>{t('room.playersAtTable')}</h3>
                <div className="players-list">
                    {playersList.length > 0 ? playersList.map((p) => (
                        <span
                            key={p.id}
                            className={`player-tag ${p.isOnline === false && !isGuestPlayer(p) ? 'player-offline' : ''} ${isGuestPlayer(p) ? 'player-guest' : ''}`}
                        >
                            {p.name}
                            {isGuestPlayer(p) && ' 📵'}
                            {p.isOnline === false && !isGuestPlayer(p) && ' 💤'}

                            {(isJoined && effectiveIsHost && p.id !== myPlayerId) && (
                                <button
                                    type="button"
                                    onClick={() => kickPlayer(p.id)}
                                    className="btn-kick"
                                    title={t('room.kickTitle', { name: p.name })}
                                >
                                    ✕
                                </button>
                            )}

                            {hasAdminPowers && p.id && (
                                <button
                                    type="button"
                                    onClick={() => adminKick(selectedGame, p.id)}
                                    className="btn-admin-kick"
                                    title={t('room.adminKickTitle')}
                                >
                                    🛑
                                </button>
                            )}
                        </span>
                    )) : <span className="empty-room-text">{t('room.emptyRoom')}</span>}
                </div>
            </div>
        </>
    );

    if (isJoined) {
        return (
            <RoomPlayersProvider playersList={playersList}>
                {content}
            </RoomPlayersProvider>
        );
    }

    return content;
}

export default memo(RoomScreen);
