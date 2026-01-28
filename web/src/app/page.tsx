'use client';

import { useState, useEffect, useRef } from 'react';
import GamesList from '@/components/GamesList';
import GameOdds from '@/components/GameOdds';
import BetSlip from '@/components/BetSlip';
import Wallet from '@/components/Wallet';
import History from '@/components/History';
import Loading from '@/components/Loading';
import { useLanguage, LanguageSwitcher } from '@/lib/LanguageContext';
import { useGamesStore } from '@/lib/store';

type View = 'betting' | 'history';
type MobileView = 'games' | 'odds' | 'slip' | 'history';

export default function Home() {
  const [view, setView] = useState<View>('betting');
  const [mobileView, setMobileView] = useState<MobileView>('games');
  const [initialLoading, setInitialLoading] = useState(true);
  const { t } = useLanguage();
  const { games, loading } = useGamesStore();

  const loadStartTime = useRef(Date.now());
  const dataReady = useRef(false);

  // Show loading screen for at least 2 seconds (for the animation to be visible)
  useEffect(() => {
    const MIN_DISPLAY_TIME = 2000; // 2 seconds minimum

    // Mark data as ready when games loaded
    if (games.length > 0 || !loading) {
      dataReady.current = true;
    }

    // Calculate remaining time to show animation
    const elapsed = Date.now() - loadStartTime.current;
    const remainingTime = Math.max(0, MIN_DISPLAY_TIME - elapsed);

    // If data is ready, wait for minimum time then hide
    if (dataReady.current) {
      const timer = setTimeout(() => {
        setInitialLoading(false);
      }, remainingTime);
      return () => clearTimeout(timer);
    }

    // Max timeout of 5 seconds even if data not ready
    const maxTimer = setTimeout(() => {
      setInitialLoading(false);
    }, 5000);

    return () => clearTimeout(maxTimer);
  }, [games.length, loading]);

  // Show Tsubasa loading animation on initial load
  if (initialLoading) {
    return <Loading />;
  }

  const handleMobileNav = (mv: MobileView) => {
    setMobileView(mv);
    if (mv === 'history') {
      setView('history');
    } else {
      setView('betting');
    }
  };

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="nav">
        <div className="nav-brand">sports<span className="brand-accent">.</span>bet</div>
        <div className="nav-links">
          <button
            className={`nav-link ${view === 'betting' ? 'active' : ''}`}
            onClick={() => setView('betting')}
          >
            {t.nav.games}
          </button>
          <button
            className={`nav-link ${view === 'history' ? 'active' : ''}`}
            onClick={() => setView('history')}
          >
            {t.nav.history}
          </button>
          <LanguageSwitcher />
        </div>
      </nav>

      {view === 'betting' ? (
        <div className="layout">
          {/* Left Sidebar - Games Only (Football) */}
          <div className={`sidebar sidebar-games flex flex-col ${mobileView === 'games' ? 'mobile-active' : ''}`}>
            <GamesList />
          </div>

          {/* Main Content - Game Odds */}
          <main className={`main overflow-auto ${mobileView === 'odds' ? 'mobile-active' : ''}`}>
            <GameOdds />
          </main>

          {/* Right Sidebar - Bet Slip & Wallet */}
          <div className={`sidebar flex flex-col border-l border-[var(--border-light)] ${mobileView === 'slip' ? 'mobile-active' : ''}`}>
            <Wallet />
            <div className="flex-1 overflow-hidden">
              <BetSlip />
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto">
          <History />
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-nav">
        <div className="mobile-nav-items">
          <button
            className={`mobile-nav-item ${mobileView === 'games' && view === 'betting' ? 'active' : ''}`}
            onClick={() => handleMobileNav('games')}
          >
            <span className="mobile-nav-icon">&#9917;</span>
            <span>{t.nav.games}</span>
          </button>
          <button
            className={`mobile-nav-item ${mobileView === 'odds' && view === 'betting' ? 'active' : ''}`}
            onClick={() => handleMobileNav('odds')}
          >
            <span className="mobile-nav-icon">&#128200;</span>
            <span>{t.betting.odds}</span>
          </button>
          <button
            className={`mobile-nav-item ${mobileView === 'slip' && view === 'betting' ? 'active' : ''}`}
            onClick={() => handleMobileNav('slip')}
          >
            <span className="mobile-nav-icon">&#128179;</span>
            <span>{t.nav.betSlip}</span>
          </button>
          <button
            className={`mobile-nav-item ${view === 'history' ? 'active' : ''}`}
            onClick={() => handleMobileNav('history')}
          >
            <span className="mobile-nav-icon">&#128202;</span>
            <span>{t.nav.history}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
