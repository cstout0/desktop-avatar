// Clicks through an NSIS installer or uninstaller like a person would, but on a hidden desktop, so
// nothing appears on (or steals focus from) the real screen. Prints every page's text and saves a
// screenshot of each page.
//
//   installer-probe install   <setup.exe>     <outDir> <installDir>
//   installer-probe uninstall <uninstall.exe> <outDir> [arguments]
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Probe
{
    const uint GENERIC_ALL = 0x10000000;
    const uint BELOW_NORMAL_PRIORITY_CLASS = 0x4000;
    const uint WM_COMMAND = 0x0111, WM_SETTEXT = 0x000C, WM_GETTEXT = 0x000D;
    const uint BM_GETCHECK = 0x00F0, BM_SETCHECK = 0x00F1;
    const uint SMTO_ABORTIFHUNG = 0x0002;
    const int GWL_STYLE = -16;
    const uint STILL_ACTIVE = 259;

    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr devmode, uint flags, uint access, IntPtr sa);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetThreadDesktop(IntPtr desktop);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr desktop, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, StringBuilder lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")]
    static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    static string Text(IntPtr hwnd)
    {
        var sb = new StringBuilder(2048);
        IntPtr r;
        SendMessageTimeout(hwnd, WM_GETTEXT, (IntPtr)sb.Capacity, sb, SMTO_ABORTIFHUNG, 3000, out r);
        return sb.ToString();
    }

    static string ClassOf(IntPtr hwnd)
    {
        var sb = new StringBuilder(256);
        GetClassName(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    static IntPtr Send(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        IntPtr r;
        SendMessageTimeout(hwnd, msg, wParam, lParam, SMTO_ABORTIFHUNG, 10000, out r);
        return r;
    }

    static List<IntPtr> Dialogs(IntPtr desktop)
    {
        var found = new List<IntPtr>();
        EnumDesktopWindows(desktop, (h, l) => { if (IsWindowVisible(h) && ClassOf(h) == "#32770") found.Add(h); return true; }, IntPtr.Zero);
        return found;
    }

    static List<IntPtr> Controls(IntPtr dialog)
    {
        var found = new List<IntPtr>();
        EnumChildWindows(dialog, (h, l) => { if (IsWindowVisible(h)) found.Add(h); return true; }, IntPtr.Zero);
        return found;
    }

    static int ButtonKind(IntPtr hwnd) { return GetWindowLong(hwnd, GWL_STYLE) & 0xF; }
    static bool IsCheckbox(IntPtr hwnd) { int k = ButtonKind(hwnd); return k == 2 || k == 3 || k == 5 || k == 6; }
    static bool IsRadio(IntPtr hwnd) { int k = ButtonKind(hwnd); return k == 4 || k == 9; }

    // Identifies a page: NSIS makes a new inner dialog (id 1018) for each one.
    static string Signature(IntPtr dialog)
    {
        IntPtr next = GetDlgItem(dialog, 1);
        return dialog + "|" + GetDlgItem(dialog, 1018) + "|" + Text(dialog) + "|" + (next == IntPtr.Zero ? "" : Text(next) + IsWindowEnabled(next));
    }

    static void Describe(IntPtr dialog, int n, string outDir, string prefix)
    {
        Console.WriteLine();
        Console.WriteLine("--- " + prefix + " page " + n + ": window \"" + Text(dialog) + "\"");
        foreach (IntPtr c in Controls(dialog))
        {
            string cls = ClassOf(c), text = Text(c).Replace("\r\n", " / ").Replace("\n", " / ");
            if (cls == "#32770") continue;
            if (cls == "msctls_progress32") { Console.WriteLine("  [progress bar]"); continue; }
            if (text.Length == 0) continue;
            string state = "";
            if (cls == "Button")
            {
                if (IsCheckbox(c) || IsRadio(c)) state = Send(c, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero) == (IntPtr)1 ? " [x]" : " [ ]";
                if (!IsWindowEnabled(c)) state += " (disabled)";
            }
            Console.WriteLine("  " + cls + " #" + GetDlgCtrlID(c) + state + ": " + text);
        }
        Shot(dialog, Path.Combine(outDir, prefix + "-" + n + ".png"));
    }

    static void Shot(IntPtr hwnd, string path)
    {
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return;
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return;
        foreach (uint flags in new uint[] { 2, 0 })  // PW_RENDERFULLCONTENT, then a plain WM_PRINT
        {
            using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    IntPtr hdc = g.GetHdc();
                    PrintWindow(hwnd, hdc, flags);
                    g.ReleaseHdc(hdc);
                }
                if (Blank(bmp)) continue;
                bmp.Save(path, ImageFormat.Png);
                return;
            }
        }
        Console.WriteLine("  (screenshot came out blank)");
    }

    static bool Blank(Bitmap bmp)
    {
        Color first = bmp.GetPixel(bmp.Width / 2, bmp.Height / 2);
        for (int y = 0; y < bmp.Height; y += 7)
            for (int x = 0; x < bmp.Width; x += 7)
                if (bmp.GetPixel(x, y) != first) return false;
        return true;
    }

    static int Run(string[] args)
    {
        string mode = args[0], exe = args[1], outDir = args[2];
        string installDir = mode == "install" && args.Length > 3 ? args[3] : null;
        string cmd = "\"" + exe + "\"" + (mode == "uninstall" && args.Length > 3 ? " " + args[3] : "");
        Directory.CreateDirectory(outDir);

        string name = "da-probe-" + Environment.TickCount;
        IntPtr desktop = CreateDesktop(name, IntPtr.Zero, IntPtr.Zero, 0, GENERIC_ALL, IntPtr.Zero);
        if (desktop == IntPtr.Zero) { Console.WriteLine("CreateDesktop failed: " + Marshal.GetLastWin32Error()); return 2; }
        if (!SetThreadDesktop(desktop)) { Console.WriteLine("SetThreadDesktop failed: " + Marshal.GetLastWin32Error()); return 2; }

        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.lpDesktop = "WinSta0\\" + name;
        PROCESS_INFORMATION pi;
        if (!CreateProcess(null, new StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, false, BELOW_NORMAL_PRIORITY_CLASS, IntPtr.Zero, null, ref si, out pi))
        {
            Console.WriteLine("CreateProcess failed: " + Marshal.GetLastWin32Error());
            return 2;
        }
        Console.WriteLine("started " + cmd + " on hidden desktop " + name);

        string last = null;
        int pages = 0, problems = 0;
        bool clickedFinish = false;
        DateTime quietSince = DateTime.Now, deadline = DateTime.Now.AddMinutes(6);
        while (DateTime.Now < deadline)
        {
            Thread.Sleep(300);
            List<IntPtr> dialogs = Dialogs(desktop);
            if (dialogs.Count == 0)
            {
                uint code;
                GetExitCodeProcess(pi.hProcess, out code);
                // The uninstaller relaunches itself from %TEMP%, so give its window time to appear.
                if (code != STILL_ACTIVE && (DateTime.Now - quietSince).TotalSeconds > (clickedFinish ? 3 : 15))
                {
                    Console.WriteLine();
                    Console.WriteLine("done: exit code " + code + ", " + pages + " pages, " + problems + " unexpected");
                    CloseDesktop(desktop);
                    return clickedFinish && problems == 0 ? 0 : 1;
                }
                continue;
            }
            quietSince = DateTime.Now;
            IntPtr dialog = dialogs[0];
            string sig = Signature(dialog);
            if (sig == last) continue;
            Thread.Sleep(800);  // let the page finish building
            if (Signature(dialog) != sig) continue;
            last = sig;
            pages++;
            Describe(dialog, pages, outDir, mode);

            IntPtr next = GetDlgItem(dialog, 1);
            if (GetDlgItem(dialog, 1018) == IntPtr.Zero)
            {
                problems++;
                Console.WriteLine("  -> unexpected message box; closing it");
                Send(dialog, WM_COMMAND, (IntPtr)(next != IntPtr.Zero ? 1 : 2), IntPtr.Zero);
                continue;
            }
            if (next == IntPtr.Zero || !IsWindowEnabled(next)) continue;  // still working

            foreach (IntPtr c in Controls(dialog))
            {
                string cls = ClassOf(c);
                if (cls == "Edit" && GetDlgCtrlID(c) == 1019 && installDir != null)
                {
                    IntPtr r;
                    SendMessageTimeout(c, WM_SETTEXT, IntPtr.Zero, installDir, SMTO_ABORTIFHUNG, 3000, out r);
                    Console.WriteLine("  -> install folder changed to " + installDir + " for the test");
                }
                if (cls == "Button" && IsCheckbox(c) && Text(c).Replace("&", "").StartsWith("Run "))
                {
                    Send(c, BM_SETCHECK, IntPtr.Zero, IntPtr.Zero);
                    Console.WriteLine("  -> unticked \"" + Text(c) + "\" (it would start the app on the real desktop)");
                }
            }
            string label = Text(next).Replace("&", "");
            Console.WriteLine("  -> clicking \"" + label + "\"");
            if (label == "Finish") clickedFinish = true;
            Send(dialog, WM_COMMAND, (IntPtr)1, next);
        }
        Console.WriteLine("timed out");
        return 3;
    }

    static int Main(string[] args)
    {
        int code = 1;
        // A fresh thread has no windows yet, so it's allowed to move to the hidden desktop.
        var t = new Thread(() => { try { code = Run(args); } catch (Exception e) { Console.WriteLine(e); code = 4; } });
        t.Start();
        t.Join();
        return code;
    }
}
