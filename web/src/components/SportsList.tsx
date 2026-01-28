'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSportsStore } from '@/lib/store';
import { Sport } from '@/lib/types';

export default function SportsList() {
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { selectedSport, selectSport } = useSportsStore();

  const fetchSports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sports');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSports(data.sports || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSports();
  }, [fetchSports]);

  const handleSelectSport = (slug: string | null) => {
    console.log('[SportsList] handleSelectSport called with slug:', slug);
    selectSport(slug);
  };

  if (loading && sports.length === 0) {
    return (
      <div className="empty">
        <div className="spinner mx-auto" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty">
        <p className="text-[var(--error)]">Error: {error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">Sports</div>
      <div
        className={`list-item ${selectedSport === null ? 'active' : ''}`}
        onClick={() => handleSelectSport(null)}
      >
        All Sports
      </div>
      {sports.map((sport) => (
        <div
          key={sport.sportId}
          className={`list-item ${selectedSport === sport.slug ? 'active' : ''}`}
          onClick={() => handleSelectSport(sport.slug)}
        >
          {sport.name}
        </div>
      ))}
    </div>
  );
}
