import { ADMISSION_MODES, JOIN_MODES, normalizeAdmission } from './roomAccess';

const JOIN_MODE_ICONS = {
    public: '🌐',
    password: '🔐',
    invite: '🔗',
};

const ADMISSION_ICONS = {
    open: '🔓',
    approval: '✋',
    closed: '🔒',
};

const ADMISSION_BUTTON_CLASS = {
    open: 'unlocked',
    approval: 'approval',
    closed: 'locked',
};

export function getJoinModeOptions(t) {
    return JOIN_MODES.map((id) => ({
        id,
        icon: JOIN_MODE_ICONS[id],
        label: t(`joinModes.${id}.label`),
        desc: t(`joinModes.${id}.desc`),
    }));
}

export function getAdmissionOptions(t) {
    return ADMISSION_MODES.map((id) => ({
        id,
        icon: ADMISSION_ICONS[id],
        label: t(`admission.${id}.label`),
        desc: t(`admission.${id}.desc`),
        buttonClass: ADMISSION_BUTTON_CLASS[id],
    }));
}

export function getAdmissionOption(admission, t) {
    const id = normalizeAdmission({ admission });
    return getAdmissionOptions(t).find((opt) => opt.id === id) || getAdmissionOptions(t)[0];
}
