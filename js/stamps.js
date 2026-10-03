/*
 * 매일 한자 — 출석 도장 그림 (이번 주 상황판)
 * SVG라 화면 크기와 상관없이 또렷하고, 따로 그림 파일이 필요 없어요.
 */
const STAMP_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-8 50 50)">
      <circle cx="50" cy="50" r="45" fill="none" stroke="#e8902a" stroke-width="5" stroke-dasharray="7 4"/>
      <path d="M50 14 L59 38 L85 39 L65 55 L72 80 L50 66 L28 80 L35 55 L15 39 L41 38 Z" fill="#f5b72f" stroke="#e8902a" stroke-width="3" stroke-linejoin="round"/>
      <text x="50" y="57" text-anchor="middle" font-size="15" font-weight="800" fill="#8a4a07" font-family="'Jua','Noto Sans KR',sans-serif">출석</text></g></svg>`;
