import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildGameContent, buildGameContentShell } from '../lib/gameContentLoader';
import { loadUiSettings, notifyUiSettingsChanged, UI_SETTINGS_KEY } from '../lib/uiSettings';
import {
    createTranslator,
    detectInitialLocale,
    getGameRules as resolveGameRules,
    getUiMessages,
    resolveLocaleId,
    SUPPORTED_LOCALES,
} from './index';
import { LocaleContext } from './useLocale.js';

function persistLocale(locale) {
    if (typeof window === 'undefined') return;
    try {
        const prev = loadUiSettings() || {};
        window.localStorage.setItem(
            UI_SETTINGS_KEY,
            JSON.stringify({ ...prev, locale })
        );
        notifyUiSettingsChanged();
    } catch {
        /* ignore */
    }
}

export function LocaleProvider({ children }) {
    const [locale, setLocaleState] = useState(detectInitialLocale);
    const [gameContent, setGameContent] = useState(() => buildGameContentShell(detectInitialLocale()));

    const messages = useMemo(() => getUiMessages(locale), [locale]);
    const t = useMemo(() => createTranslator(messages), [messages]);

    useEffect(() => {
        let cancelled = false;
        setGameContent(buildGameContentShell(locale));
        void buildGameContent(locale).then((content) => {
            if (!cancelled) setGameContent(content);
        });
        return () => {
            cancelled = true;
        };
    }, [locale]);

    const setLocale = useCallback((next) => {
        const resolved = resolveLocaleId(next);
        setLocaleState(resolved);
        persistLocale(resolved);
    }, []);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.lang = locale;
    }, [locale]);

    const getGameRules = useCallback(
        (gameId) => resolveGameRules(messages, gameId),
        [messages]
    );

    const value = useMemo(() => ({
        locale,
        setLocale,
        t,
        getGameRules,
        gameContent,
        supportedLocales: SUPPORTED_LOCALES,
    }), [locale, setLocale, t, getGameRules, gameContent]);

    return (
        <LocaleContext.Provider value={value}>
            {children}
        </LocaleContext.Provider>
    );
}

export { useLocale, useLocaleOptional } from './useLocale.js';
