/**
 * TapAct orbit mark: a central "tap" point with a satellite riding a violet-to-cyan orbit.
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
      <stop offset="0" stop-color="#16141f"/>
      <stop offset="1" stop-color="#07070b"/>
    </linearGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8E7BFF"/>
      <stop offset="1" stop-color="#5FE3FF"/>
    </linearGradient>
  </defs>
  ${background}
  <circle cx="256" cy="256" r="146" fill="none" stroke="url(#arc)" stroke-width="22"/>
  <circle cx="256" cy="256" r="50" fill="#f4f3fa"/>
  <circle cx="256" cy="110" r="34" fill="#5FE3FF" stroke="#07070b" stroke-width="14"/>
</svg>`;
}
