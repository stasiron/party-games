import { createContext, useContext } from 'react';

export const LocaleContext = createContext(null);

export function useLocale() {
    const ctx = useContext(LocaleContext);
    if (!ctx) {
        throw new Error('useLocale must be used within LocaleProvider');
    }
    return ctx;
}

export function useLocaleOptional() {
    return useContext(LocaleContext);
}
