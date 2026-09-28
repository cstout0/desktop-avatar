// Decides which monitors are occupied by a fullscreen app (game, video, F11
// browser...). Pure function over physical-pixel rects (unit tested).

const WS_CAPTION = 0x00c00000;
const WS_EX_TOPMOST = 0x00000008;
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow']);
// QUERY_USER_NOTIFICATION_STATE values that mean "a fullscreen app is running".
const QUNS_FULLSCREEN = new Set([2, 3, 4]);

const covers = (r, m, tol = 2) => r.left <= m.left + tol && r.top <= m.top + tol && r.right >= m.right - tol && r.bottom >= m.bottom - tol;

function overlapFrac(r, m) {
  const w = Math.max(0, Math.min(r.right, m.right) - Math.max(r.left, m.left));
  const h = Math.max(0, Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top));
  return (w * h) / ((m.right - m.left) * (m.bottom - m.top));
}

const hasCaption = (style) => (style & WS_CAPTION) === WS_CAPTION;

/**
 * @param monitors [{ id, rect }]                       physical monitor rects
 * @param windows  [{ rect, style, exStyle, className }] z-order, topmost first
 * @param fg       foreground window info (see win32.foregroundInfo) or null
 * @param quns     SHQueryUserNotificationState result
 * @param ownPid   our process id (our overlays never count)
 * @returns Set of monitor ids that are fullscreen
 */
export function fullscreenMonitors({ monitors, windows, fg, quns, ownPid }) {
  const out = new Set();
  for (const m of monitors) {
    // 1) The foreground window fills this monitor and is captionless (or Windows says "busy").
    if (fg && fg.pid !== ownPid && !fg.isShell && !SHELL_CLASSES.has(fg.className) && covers(fg.rect, m.rect)) {
      const monOk = !fg.monitorRect || (fg.monitorRect.left === m.rect.left && fg.monitorRect.top === m.rect.top);
      if (monOk && (!hasCaption(fg.style) || QUNS_FULLSCREEN.has(quns))) {
        out.add(m.id);
        continue;
      }
    }
    // 2) Z-order scan: a captionless window covering the monitor, not buried under a
    //    big normal window (so alt-tabbing away from a game frees the monitor).
    for (const w of windows) {
      if (overlapFrac(w.rect, m.rect) <= 0) continue;
      if (SHELL_CLASSES.has(w.className)) continue;
      if (covers(w.rect, m.rect) && !hasCaption(w.style)) {
        out.add(m.id);
        break;
      }
      if (!(w.exStyle & WS_EX_TOPMOST) && overlapFrac(w.rect, m.rect) >= 0.5) break;
    }
  }
  return out;
}
