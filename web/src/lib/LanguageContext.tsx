'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Language, translations, TranslationKeys } from './translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('sq'); // Default to Albanian

  useEffect(() => {
    // Load saved language preference
    const saved = localStorage.getItem('language') as Language;
    if (saved && (saved === 'en' || saved === 'sq')) {
      setLanguageState(saved);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('language', lang);
  };

  const t = translations[language];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
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

// Language switcher component
export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="language-switcher">
      <button
        onClick={() => setLanguage(language === 'en' ? 'sq' : 'en')}
        className="lang-btn"
        title={language === 'en' ? 'Switch to Albanian' : 'Switch to English'}
      >
        <span className={`flag ${language === 'en' ? 'active' : ''}`}>🇬🇧</span>
        <span className="separator">/</span>
        <span className={`flag ${language === 'sq' ? 'active' : ''}`}>🇦🇱</span>
      </button>

      <style jsx>{`
        .language-switcher {
          display: flex;
          align-items: center;
        }

        .lang-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 10px;
          background: var(--background-secondary, #f5f5f5);
          border: 1px solid var(--border-light, #e0e0e0);
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          transition: all 0.2s ease;
        }

        .lang-btn:hover {
          background: var(--background-tertiary, #ebebeb);
        }

        .flag {
          opacity: 0.5;
          transition: opacity 0.2s ease;
        }

        .flag.active {
          opacity: 1;
        }

        .separator {
          color: var(--foreground-muted, #888);
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
