Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class Win32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

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

    public static List<string> GetOpenWindows() {
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
                            windows.Add("{\"title\":\"" + escapedTitle + "\", \"x\":" + rect.Left + ", \"y\":" + rect.Top + ", \"w\":" + w + ", \"h\":" + h + "}");
                        }
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
        return windows;
    }
}
"@
$windows = [Win32]::GetOpenWindows()
Write-Output "[$([string]::Join(',', $windows))]"
