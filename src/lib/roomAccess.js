export const JOIN_MODES = ['public', 'password', 'invite'];
export const ADMISSION_MODES = ['open', 'approval', 'closed'];

export const JOIN_MODE_OPTIONS = [
    {
        id: 'public',
        label: 'Publiczny',
        icon: '🌐',
        desc: 'Gość z listy wpisuje nick i wchodzi.',
    },
    {
        id: 'password',
        label: 'Z hasłem',
        icon: '🔐',
        desc: 'Z listy wymagane hasło. Link i QR omijają hasło.',
    },
    {
        id: 'invite',
        label: 'Tylko zaproszenie',
        icon: '🔗',
        desc: 'Z listy brak wejścia. Kod domyślnie ukryty — host może go włączyć na liście.',
    },
];

export const ADMISSION_OPTIONS = [
    {
        id: 'open',
        label: 'Otwarty',
        icon: '🔓',
        desc: 'Nowi gracze wchodzą od razu (wg trybu pokoju).',
        buttonClass: 'unlocked',
    },
    {
        id: 'approval',
        label: 'Za pozwoleniem',
        icon: '✋',
        desc: 'Prośby trafiają do kolejki — host decyduje.',
        buttonClass: 'approval',
    },
    {
        id: 'closed',
        label: 'Zamknięty',
        icon: '🔒',
        desc: 'Nikt nowy nie dołączy (wracający gracze — tak).',
        buttonClass: 'locked',
    },
];

export function normalizeJoinMode(room) {
    const mode = String(room?.joinMode || '');
    if (JOIN_MODES.includes(mode)) return mode;
    if (room?.isPrivate === true && room?.passwordHash) return 'password';
    if (room?.isPrivate === true) return 'invite';
    return 'public';
}

export function normalizeAdmission(room) {
    const admission = String(room?.admission || '');
    if (ADMISSION_MODES.includes(admission)) return admission;
    return room?.isLocked === true ? 'closed' : 'open';
}

export function isAdmissionClosed(room) {
    return normalizeAdmission(room) === 'closed';
}

export function defaultShowCodeInList(joinMode) {
    return normalizeJoinMode({ joinMode }) !== 'invite';
}

export function showRoomCodeInList(room) {
    if (typeof room?.showCodeInList === 'boolean') return room.showCodeInList;
    return defaultShowCodeInList(room?.joinMode);
}

export function getJoinModeListBadge(joinMode) {
    switch (normalizeJoinMode({ joinMode })) {
        case 'password':
            return '🔐';
        case 'invite':
            return '🔗';
        default:
            return '';
    }
}

export function getAdmissionListBadge(admission) {
    switch (normalizeAdmission({ admission })) {
        case 'closed':
            return '🔒';
        case 'approval':
            return '✋';
        default:
            return '';
    }
}

export function getAdmissionOption(admission) {
    const id = normalizeAdmission({ admission });
    return ADMISSION_OPTIONS.find((opt) => opt.id === id) || ADMISSION_OPTIONS[0];
}

export function cycleAdmission(current) {
    const id = normalizeAdmission({ admission: current });
    const idx = ADMISSION_MODES.indexOf(id);
    return ADMISSION_MODES[(idx + 1) % ADMISSION_MODES.length];
}

export function canJoinFromList(joinMode) {
    return normalizeJoinMode({ joinMode }) !== 'invite';
}

export function needsPasswordFromList(joinMode, joinViaInvite) {
    if (joinViaInvite) return false;
    return normalizeJoinMode({ joinMode }) === 'password';
}

export function needsApprovalToJoin(room, joinViaInvite, isReconnect) {
    if (joinViaInvite || isReconnect) return false;
    return normalizeAdmission(room) === 'approval';
}

export function isRoomClosedForNewPlayers(room, joinViaInvite, isReconnect) {
    if (joinViaInvite || isReconnect) return false;
    return normalizeAdmission(room) === 'closed';
}

export function countPendingJoinRequests(joinRequestsMap) {
    return Object.values(joinRequestsMap || {}).filter(
        (req) => req && (req.status === 'pending' || !req.status)
    ).length;
}
