using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
using System.Threading;

public class WindowTracker {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
    
    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    const int DWMWA_CLOAKED = 14;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x00000080;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static bool IsCloaked(IntPtr hWnd) {
        int cloaked;
        int res = DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, sizeof(int));
        if (res == 0) {
            return cloaked != 0;
        }
        return false;
    }

    public static void Main() {
        new Thread(() => {
            while (true) {
                string line = Console.ReadLine();
                if (line != null) {
                    if (line.StartsWith("MOUSE:")) {
                        var parts = line.Substring(6).Split(':');
                        int x, y;
                        if (parts.Length == 2 && int.TryParse(parts[0], out x) && int.TryParse(parts[1], out y)) {
                            SetCursorPos(x, y);
                        }
                    } else if (line.StartsWith("WINDOW:")) {
                        var parts = line.Substring(7).Split(':');
                        long hwnd;
                        int x, y;
                        if (parts.Length >= 3 && long.TryParse(parts[0], out hwnd) && int.TryParse(parts[1], out x) && int.TryParse(parts[2], out y)) {
                            // 0x0001 (SWP_NOSIZE) | 0x0004 (SWP_NOZORDER) = 0x0005
                            SetWindowPos(new IntPtr(hwnd), IntPtr.Zero, x, y, 0, 0, 0x0005);
                        }
                    } else if (line.StartsWith("CLOSE:")) {
                        long hwnd;
                        if (long.TryParse(line.Substring(6), out hwnd)) {
                            PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
                        }
                    }
                }
            }
        }) { IsBackground = true }.Start();
        
        // High frequency loop: 30fps is ~33ms, 60fps is ~16ms
        while (true) {
            var windows = new List<string>();
            
            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd) && !IsIconic(hWnd) && !IsCloaked(hWnd)) {
                    int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
                    if ((exStyle & WS_EX_TOOLWINDOW) != 0) {
                        return true;
                    }
                    
                    StringBuilder sb = new StringBuilder(256);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    string title = sb.ToString();
                    
                    if (!string.IsNullOrEmpty(title) && title != "Program Manager") {
                        RECT rect;
                        if (GetWindowRect(hWnd, out rect)) {
                            int w = rect.Right - rect.Left;
                            int h = rect.Bottom - rect.Top;
                            if (w > 0 && h > 0) {
                                string escapedTitle = title.Replace("\\", "\\\\").Replace("\"", "\\\"");
                                long hwndVal = hWnd.ToInt64();
                                windows.Add("{\"hwnd\":" + hwndVal + ", \"title\":\"" + escapedTitle + "\", \"x\":" + rect.Left + ", \"y\":" + rect.Top + ", \"w\":" + w + ", \"h\":" + h + "}");
                            }
                        }
                    }
                }
                return true;
            }, IntPtr.Zero);
            
            Console.WriteLine("[" + string.Join(",", windows) + "]");
            
            Thread.Sleep(33); // ~30 fps updates for smooth tracking
        }
    }
}
