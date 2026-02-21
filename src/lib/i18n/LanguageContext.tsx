'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Language } from './translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

const STORAGE_KEY = 'adlerlicht-language';

function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'de';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'de' ? stored : 'de';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [languageOverride, setLanguageOverride] = useState<Language | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => { setIsHydrated(true); }, []);

  const language = languageOverride ?? (isHydrated ? getStoredLanguage() : 'de');

  const contextValue = useMemo(() => {
    const setLanguage = (lang: Language) => {
      setLanguageOverride(lang);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, lang);
      }
    };
    return {
      language,
      setLanguage,
      toggleLanguage: () => setLanguage(language === 'de' ? 'en' : 'de'),
    };
  }, [language]);

  return (
    <LanguageContext.Provider value={contextValue}>
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
