'use client';

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Language } from './translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

const STORAGE_KEY = 'de-puls-language';

function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'de';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'de' ? stored : 'de';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [languageOverride, setLanguageOverride] = useState<Language | null>(null);
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const language = languageOverride ?? (isHydrated ? getStoredLanguage() : 'de');

  const setLanguage = (lang: Language) => {
    setLanguageOverride(lang);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, lang);
    }
  };

  const toggleLanguage = () => {
    setLanguage(language === 'de' ? 'en' : 'de');
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

// Convenience hook that also provides translation helpers
export function useTranslation() {
  const { language, setLanguage, toggleLanguage } = useLanguage();

  return {
    lang: language,
    setLanguage,
    toggleLanguage,
    isEnglish: language === 'en',
    isGerman: language === 'de',
  };
}
