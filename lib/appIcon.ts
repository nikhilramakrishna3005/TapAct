/**
 * Original TapAct mark: a goal ring with a progress arc around a central "tap" dot.
 * `maskable` fills the full square so launchers can crop it; content stays inside
 * the 80% safe zone either way.
 */
export function getAppIconSvg({ maskable }: { maskable: boolean }): string {
  const background = maskable
    ? `<rect width="512" height="512" fill="url(#bg)"/>`
    : `<rect width="512" height="512" rx="116" fill="url(#bg)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#171d27"/>
      <stop offset="1" stop-color="#090b10"/>
    </linearGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9DA7FF"/>
      <stop offset="1" stop-color="#4FD1A5"/>
    </linearGradient>
  </defs>
  ${background}
  <circle cx="256" cy="256" r="150" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="34"/>
  <path d="M256 106 A150 150 0 1 1 106 256" fill="none" stroke="url(#arc)" stroke-width="34" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="54" fill="#edf2f7"/>
</svg>`;
}
