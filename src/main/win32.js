// Thin Win32 layer (via koffi FFI). Everything here is synchronous and cheap
// (microseconds per call), so it is safe to poll from the main process.
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const shell32 = koffi.load('shell32.dll');
const kernel32 = koffi.load('kernel32.dll');

const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
koffi.alias('HWND', HANDLE);
koffi.alias('HMONITOR', HANDLE);

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
koffi.struct('POINT', { x: 'long', y: 'long' });
const MONITORINFO = koffi.struct('MONITORINFO', {
  cbSize: 'uint32_t',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32_t',
});

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)');

const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hwnd)');
const IsWindow = user32.func('bool __stdcall IsWindow(HWND hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(HWND hwnd)');
const IsZoomed = user32.func('bool __stdcall IsZoomed(HWND hwnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(HWND hwnd, _Out_ char16_t *buf, int max)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(HWND hwnd, _Out_ char16_t *buf, int max)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int index)');
const SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongPtrW(HWND hwnd, int index, intptr_t value)');
const GetWindow = user32.func('HWND __stdcall GetWindow(HWND hwnd, uint32_t cmd)');
const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow()');
const GetShellWindow = user32.func('HWND __stdcall GetShellWindow()');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *pid)');
const MonitorFromWindow = user32.func('HMONITOR __stdcall MonitorFromWindow(HWND hwnd, uint32_t flags)');
const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(HMONITOR mon, _Inout_ MONITORINFO *info)');
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ POINT *pt)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)');
const DwmGetWindowAttributeRect = dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, uint32_t attr, _Out_ RECT *value, uint32_t size)');
const DwmGetWindowAttributeU32 = dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, uint32_t attr, _Out_ uint32_t *value, uint32_t size)');
const SHQueryUserNotificationState = shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int *state)');
const OpenProcess = kernel32.func('HANDLE __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE h)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE h, uint32_t flags, _Out_ char16_t *buf, _Inout_ uint32_t *size)');
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const GW_OWNER = 4;
const MONITOR_DEFAULTTONEAREST = 2;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;

export const WS = {
  CAPTION: 0x00c00000,
  POPUP: 0x80000000,
  THICKFRAME: 0x00040000,
  CHILD: 0x40000000,
};
export const WS_EX = {
  TOPMOST: 0x00000008,
  TRANSPARENT: 0x00000020,
  TOOLWINDOW: 0x00000080,
  APPWINDOW: 0x00040000,
  LAYERED: 0x00080000,
  NOACTIVATE: 0x08000000,
};

const RECT_SIZE = koffi.sizeof(RECT);
const MONITORINFO_SIZE = koffi.sizeof(MONITORINFO);
const textBuf = Buffer.alloc(512);

function readText(fn, hwnd) {
  const n = fn(hwnd, textBuf, 256);
  return n > 0 ? koffi.decode(textBuf, 'char16_t', n) : '';
}

/** Electron's getNativeWindowHandle() Buffer -> BigInt HWND */
export function hwndFromBuffer(buf) {
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

function frameRect(hwnd) {
  // Extended frame bounds excludes the invisible resize borders Windows 10/11 add.
  const r = {};
  if (DwmGetWindowAttributeRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, RECT_SIZE) === 0) return r;
  const r2 = {};
  return GetWindowRect(hwnd, r2) ? r2 : null;
}

function isCloaked(hwnd) {
  const out = [0];
  return DwmGetWindowAttributeU32(hwnd, DWMWA_CLOAKED, out, 4) === 0 && out[0] !== 0;
}

function pidOf(hwnd) {
  const out = [0];
  GetWindowThreadProcessId(hwnd, out);
  return out[0];
}

function toU32(v) {
  return Number(BigInt.asUintN(32, BigInt(v)));
}

/**
 * Visible top-level windows in z-order (topmost first), with physical-pixel
 * rects. Only "real" app windows are returned (roughly the Alt+Tab set).
 */
export function listWindows({ excludePids = [] } = {}) {
  const shell = GetShellWindow();
  const out = [];
  EnumWindows((hwnd) => {
    try {
      if (!IsWindowVisible(hwnd) || hwnd === shell) return true;
      const exStyle = toU32(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      const style = toU32(GetWindowLongPtrW(hwnd, GWL_STYLE));
      if (exStyle & WS_EX.TRANSPARENT) return true; // click-through overlays
      const owner = GetWindow(hwnd, GW_OWNER);
      const tool = (exStyle & WS_EX.TOOLWINDOW) && !(exStyle & WS_EX.APPWINDOW);
      if (tool) return true;
      if (owner && !(exStyle & WS_EX.APPWINDOW)) {
        // Owned windows (dialogs) are fine as platforms if they have a caption.
        if (!(style & WS.CAPTION)) return true;
      }
      if (isCloaked(hwnd)) return true; // other virtual desktops, suspended UWP
      const pid = pidOf(hwnd);
      if (excludePids.includes(pid)) return true;
      const iconic = IsIconic(hwnd);
      if (iconic) return true;
      const rect = frameRect(hwnd);
      if (!rect) return true;
      const w = rect.right - rect.left;
      const h = rect.bottom - rect.top;
      if (w < 80 || h < 40) return true;
      const title = readText(GetWindowTextW, hwnd);
      const className = readText(GetClassNameW, hwnd);
      if (!title && className !== 'Shell_TrayWnd') return true;
      out.push({ hwnd, title, className, pid, rect, style, exStyle, zoomed: IsZoomed(hwnd) });
    } catch {
      // Window vanished mid-enumeration; skip it.
    }
    return true;
  }, 0);
  return out;
}

export function windowRect(hwnd) {
  if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return null;
  return frameRect(hwnd);
}

function monitorOf(hwnd) {
  const mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (!mon) return null;
  const info = { cbSize: MONITORINFO_SIZE };
  return GetMonitorInfoW(mon, info) ? info : null;
}

/** Facts about the foreground window, used for fullscreen detection. */
export function foregroundInfo() {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;
  const rect = {};
  if (!GetWindowRect(hwnd, rect)) return null; // raw rect: fullscreen windows fill the monitor exactly
  const mon = monitorOf(hwnd);
  if (!mon) return null;
  return {
    hwnd,
    pid: pidOf(hwnd),
    title: readText(GetWindowTextW, hwnd),
    className: readText(GetClassNameW, hwnd),
    rect,
    monitorRect: mon.rcMonitor,
    workRect: mon.rcWork,
    style: toU32(GetWindowLongPtrW(hwnd, GWL_STYLE)),
    exStyle: toU32(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)),
    zoomed: IsZoomed(hwnd),
    isShell: hwnd === GetShellWindow(),
  };
}

/** QUNS_*: 1 not present, 2 busy (fullscreen app), 3 D3D fullscreen, 4 presentation, 5 accepts notifications, 6 quiet time, 7 app */
export function notificationState() {
  const out = [0];
  return SHQueryUserNotificationState(out) === 0 ? out[0] : 0;
}

/** Hide an overlay from Alt+Tab and the taskbar. */
export function makeToolWindow(hwnd) {
  const ex = toU32(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  const next = (ex | WS_EX.TOOLWINDOW) & ~WS_EX.APPWINDOW;
  if (next !== ex) SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
  return toU32(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
}

export function exStyleOf(hwnd) {
  return toU32(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
}

const procNames = new Map();

/** "Spotify.exe" for a process id (cached; '' if it can't be read). */
export function processName(pid) {
  if (procNames.has(pid)) return procNames.get(pid);
  let name = '';
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (h) {
    try {
      const buf = Buffer.alloc(2048);
      const size = [1024];
      if (QueryFullProcessImageNameW(h, 0, buf, size)) name = koffi.decode(buf, 'char16_t', size[0]).split('\\').pop();
    } finally {
      CloseHandle(h);
    }
  }
  if (procNames.size > 500) procNames.clear();
  procNames.set(pid, name);
  return name;
}

export function cursorPos() {
  const p = {};
  return GetCursorPos(p) ? p : null;
}

const VK = {
  playpause: 0xb3,
  next: 0xb0,
  prev: 0xb1,
  stop: 0xb2,
  mute: 0xad,
  voldown: 0xae,
  volup: 0xaf,
};
const KEYEVENTF_KEYUP = 0x2;

const KEYEVENTF_EXTENDEDKEY = 0x1;
const VK_LWIN = 0x5b;
const VK_SNAPSHOT = 0x2c;

/** Win+PrintScreen: Windows saves an (HDR-correct) screenshot to Pictures\Screenshots. */
export function screenshotKey() {
  keybd_event(VK_LWIN, 0, KEYEVENTF_EXTENDEDKEY, 0);
  keybd_event(VK_SNAPSHOT, 0, 0, 0);
  keybd_event(VK_SNAPSHOT, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_LWIN, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
}

export function pressMediaKey(name, times = 1) {
  const vk = VK[name];
  if (!vk) throw new Error(`unknown media key: ${name}`);
  for (let i = 0; i < times; i++) {
    keybd_event(vk, 0, 0, 0);
    keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
  }
}
