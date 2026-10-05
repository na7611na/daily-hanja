/*
 * 매일 한자 — 출석 도장 그림 (이번 주 상황판)
 * SVG라 화면 크기와 상관없이 또렷하고, 따로 그림 파일이 필요 없어요.
 */
const STAMP_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-8 50 50)">
      <circle cx="50" cy="50" r="45" fill="none" stroke="#e8902a" stroke-width="5" stroke-dasharray="7 4"/>
      <path d="M50 14 L59 38 L85 39 L65 55 L72 80 L50 66 L28 80 L35 55 L15 39 L41 38 Z" fill="#f5b72f" stroke="#e8902a" stroke-width="3" stroke-linejoin="round"/>
      <text x="50" y="57" text-anchor="middle" font-size="15" font-weight="800" fill="#8a4a07" font-family="'Jua','Noto Sans KR',sans-serif">출석</text></g></svg>`;

// 홈 화면 '오늘의 학습 완료' 큰 도장
const DONE_STAMP_SVG = `<svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(-10 60 60)">
      <circle cx="60" cy="60" r="55" fill="#fff7e6" stroke="#e8902a" stroke-width="5"/>
      <circle cx="60" cy="60" r="46" fill="none" stroke="#e8902a" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="M60 17 L63.5 26 L73 26.3 L65.5 32 L68.2 41 L60 35.7 L51.8 41 L54.5 32 L47 26.3 L56.5 26 Z" fill="#f5b72f" stroke="#e8902a" stroke-width="1.5" stroke-linejoin="round"/>
      <text x="60" y="62" text-anchor="middle" font-size="15" fill="#b4620f" font-family="'Jua','Noto Sans KR',sans-serif">오늘의 학습</text>
      <text x="60" y="88" text-anchor="middle" font-size="26" fill="#d6343f" font-family="'Jua','Noto Sans KR',sans-serif">완료!</text></g></svg>`;

// 학습 전: 도장을 찍을 빈 자리
const EMPTY_STAMP_SVG = `<svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="54" fill="none" stroke="#d9c6ad" stroke-width="3" stroke-dasharray="8 6"/>
      <text x="60" y="50" text-anchor="middle" font-size="17" fill="#b9a68e" font-family="'Jua','Noto Sans KR',sans-serif">매일</text>
      <text x="60" y="84" text-anchor="middle" font-size="30" fill="#b9a68e" font-family="'Noto Serif KR','Noto Serif CJK KR',serif" font-weight="700">一 字</text></svg>`;
