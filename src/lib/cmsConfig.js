import { resolveGameId } from '../data/gameIds.js';

export const CMS_ADMIN_UID = 'TD5kdOtZ6bPwTJNfcDtyOCPKmfG2';
export const APP_CONFIG_PATH = 'appConfig';

export const CMS_COMMAND_TOGGLES = [
    { id: 'RESET', labelKey: 'cms.commandReset' },
    { id: 'PURGE', labelKey: 'cms.commandPurge' },
    { id: 'PURGE_PLAYERS', labelKey: 'cms.commandPurgePlayers' },
    { id: 'PURGE_ROOMS', labelKey: 'cms.commandPurgeRooms' },
    { id: 'CLEAR', labelKey: 'cms.commandClear' },
    { id: 'REVEAL', labelKey: 'cms.commandReveal' },
    { id: 'SHOW', labelKey: 'cms.commandShow' },
    { id: 'PUPPET', labelKey: 'cms.commandPuppet' },
    { id: 'SYNC', labelKey: 'cms.commandSync' },
    { id: 'NEXT', labelKey: 'cms.commandNext' },
    { id: 'ADMIN_KICK', labelKey: 'cms.commandAdminKick' },
    { id: 'HOST', labelKey: 'cms.commandHost' },
];

export function isCmsAdminUser(user) {
    return !!user?.uid && user.uid === CMS_ADMIN_UID;
}

export function buildDefaultCmsConfig(catalogGames = []) {
    const games = {};
    for (const game of catalogGames || []) {
        if (!game?.id || game?.comingSoon === true) continue;
        games[game.id] = {
            roomCreationEnabled: true,
            roomJoinEnabled: true,
        };
    }
    const commands = {};
    for (const entry of CMS_COMMAND_TOGGLES) {
        commands[entry.id] = true;
    }
    return {
        games,
        commands,
        updatedAt: 0,
    };
}

export function normalizeCmsConfig(rawConfig, catalogGames = []) {
    const defaults = buildDefaultCmsConfig(catalogGames);
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const rawGames = config.games && typeof config.games === 'object' ? config.games : {};
    const rawCommands = config.commands && typeof config.commands === 'object' ? config.commands : {};

    const games = { ...defaults.games };
    for (const game of catalogGames || []) {
        if (!game?.id || game?.comingSoon === true) continue;
        const rawGame = rawGames[game.id] && typeof rawGames[game.id] === 'object' ? rawGames[game.id] : {};
        const roomCreationEnabled = rawGame.roomCreationEnabled !== false;
        games[game.id] = {
            roomCreationEnabled,
            roomJoinEnabled: roomCreationEnabled && rawGame.roomJoinEnabled !== false,
        };
    }

    const commands = { ...defaults.commands };
    for (const entry of CMS_COMMAND_TOGGLES) {
        commands[entry.id] = rawCommands[entry.id] !== false;
    }

    return {
        games,
        commands,
        updatedAt: Number(config.updatedAt || 0),
        banner: normalizeBannerConfig(config.banner),
    };
}

function normalizeLocalizedField(raw) {
    if (typeof raw === 'string') {
        const value = raw.trim();
        return { pl: value, en: value };
    }
    if (!raw || typeof raw !== 'object') {
        return { pl: '', en: '' };
    }
    return {
        pl: String(raw.pl || '').trim(),
        en: String(raw.en || '').trim(),
    };
}

export function normalizeBannerConfig(rawBanner) {
    if (!rawBanner || typeof rawBanner !== 'object') {
        return {
            enabled: false,
            title: { pl: '', en: '' },
            body: { pl: '', en: '' },
            updatedAt: 0,
        };
    }
    return {
        enabled: rawBanner.enabled === true,
        title: normalizeLocalizedField(rawBanner.title),
        body: normalizeLocalizedField(rawBanner.body),
        updatedAt: Number(rawBanner.updatedAt || 0),
    };
}

export function getCmsGameState(config, game) {
    if (!game?.id) {
        return {
            roomCreationEnabled: false,
            roomJoinEnabled: false,
            availability: 'missing',
        };
    }
    if (game.comingSoon === true) {
        return {
            roomCreationEnabled: false,
            roomJoinEnabled: false,
            availability: 'comingSoon',
        };
    }
    const entry = config?.games?.[game.id] || {};
    const roomCreationEnabled = entry.roomCreationEnabled !== false;
    return {
        roomCreationEnabled,
        roomJoinEnabled: roomCreationEnabled && entry.roomJoinEnabled !== false,
        availability: roomCreationEnabled ? 'live' : 'disabled',
    };
}

export function sortLobbyGames(localizedGames, config) {
    const enabled = [];
    const disabled = [];
    const comingSoon = [];
    for (const game of localizedGames || []) {
        const state = getCmsGameState(config, game);
        const next = { ...game, cmsState: state };
        if (game.comingSoon === true) {
            comingSoon.push(next);
        } else if (state.roomCreationEnabled) {
            enabled.push(next);
        } else {
            disabled.push(next);
        }
    }
    return [...enabled, ...disabled, ...comingSoon];
}

export function isGameCreationEnabled(config, gameId, catalogGames = []) {
    const resolvedId = resolveGameId(gameId);
    if (!resolvedId) return false;
    const game = (catalogGames || []).find((entry) => entry?.id === resolvedId);
    return getCmsGameState(config, game || { id: resolvedId }).roomCreationEnabled;
}

export function isGameJoinEnabled(config, gameId, catalogGames = []) {
    const resolvedId = resolveGameId(gameId);
    if (!resolvedId) return false;
    const game = (catalogGames || []).find((entry) => entry?.id === resolvedId);
    return getCmsGameState(config, game || { id: resolvedId }).roomJoinEnabled;
}

export function parseAdminCommandKey(rawCommand) {
    const raw = String(rawCommand || '').trim();
    const upper = raw.toUpperCase();
    if (upper === 'RESET') return 'RESET';
    if (upper === 'PURGE') return 'PURGE';
    if (upper === 'PURGE PLAYERS') return 'PURGE_PLAYERS';
    if (upper === 'PURGE ROOMS') return 'PURGE_ROOMS';
    if (upper === 'CLEAR') return 'CLEAR';
    if (upper === 'REVEAL') return 'REVEAL';
    if (upper === 'SHOW') return 'SHOW';
    if (upper === 'PUPPET ON' || upper === 'PUPPET OFF') return 'PUPPET';
    if (upper === 'SYNC') return 'SYNC';
    if (upper === 'NEXT' || upper === 'NEXT ROUND') return 'NEXT';
    if (upper.startsWith('ADMIN ') && raw.slice(6).trim().toUpperCase().startsWith('KICK ')) {
        return 'ADMIN_KICK';
    }
    if (upper === 'HOST' || upper.startsWith('HOST ')) return 'HOST';
    return null;
}

export function isAdminCommandEnabled(config, rawCommand) {
    const key = parseAdminCommandKey(rawCommand);
    if (!key) return true;
    return config?.commands?.[key] !== false;
}
