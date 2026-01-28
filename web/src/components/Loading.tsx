export default function Loading() {
  return (
    <div className="loading-container">
      {/* Manga speed lines */}
      <div className="manga-lines"></div>

      <div className="loading-content">
        {/* Tsubasa-style anime face */}
        <div className="anime-face">
          <svg viewBox="0 0 120 120" className="face-svg">
            {/* Face */}
            <ellipse cx="60" cy="65" rx="45" ry="50" fill="#FFE0BD"/>
            {/* Hair */}
            <path d="M15 50 Q20 20 40 15 Q50 5 60 10 Q70 5 80 15 Q100 20 105 50 Q110 40 100 60 L100 55 Q95 45 85 50 L80 40 Q70 35 65 45 L60 35 L55 45 Q50 35 40 40 L35 50 Q25 45 20 55 L20 60 Q10 40 15 50 Z" fill="#1a1a1a"/>
            {/* Left eye */}
            <ellipse cx="42" cy="60" rx="12" ry="14" fill="white"/>
            <ellipse cx="44" cy="62" rx="7" ry="9" fill="#2563eb"/>
            <ellipse cx="46" cy="59" rx="3" ry="4" fill="white"/>
            {/* Right eye */}
            <ellipse cx="78" cy="60" rx="12" ry="14" fill="white"/>
            <ellipse cx="80" cy="62" rx="7" ry="9" fill="#2563eb"/>
            <ellipse cx="82" cy="59" rx="3" ry="4" fill="white"/>
            {/* Eyebrows */}
            <path d="M28 48 Q38 42 52 48" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M68 48 Q82 42 92 48" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round"/>
            {/* Nose */}
            <path d="M60 70 L58 80 Q60 82 62 80" stroke="#D4A574" strokeWidth="2" fill="none"/>
            {/* Mouth - big smile */}
            <path d="M45 92 Q60 105 75 92" stroke="#333" strokeWidth="2" fill="none"/>
            <path d="M48 94 Q60 102 72 94" fill="#c9302c"/>
          </svg>
        </div>

        {/* Soccer ball */}
        <div className="ball-bounce">
          <svg viewBox="0 0 100 100" className="ball-svg">
            <circle cx="50" cy="50" r="48" fill="white" stroke="#333" strokeWidth="2"/>
            {/* Classic pentagon pattern */}
            <polygon points="50,15 62,35 55,50 45,50 38,35" fill="#1a1a1a"/>
            <polygon points="25,40 38,35 45,50 38,65 22,55" fill="#1a1a1a"/>
            <polygon points="75,40 62,35 55,50 62,65 78,55" fill="#1a1a1a"/>
            <polygon points="35,75 45,65 55,65 65,75 50,88" fill="#1a1a1a"/>
          </svg>
        </div>

        {/* Brand name */}
        <div className="brand-name">
          <span className="brand-sports">sports</span>
          <span className="brand-dot">.</span>
          <span className="brand-bet">bet</span>
        </div>

        {/* Loading text */}
        <div className="loading-text">
          <span>D</span>
          <span>U</span>
          <span>K</span>
          <span>E</span>
          <span className="space"></span>
          <span>I</span>
          <span>T</span>
          <span>!</span>
        </div>

        {/* Loading dots */}
        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  );
}
