//! Small Win32 helpers: idle time, fullscreen detection, cursor and other apps' windows.

/// A top-level window of another app, in physical screen pixels (the visible frame, not the invisible
/// resize border).
#[derive(Clone, Copy, Debug)]
pub struct TopWin {
    pub hwnd: isize,
    pub l: f64,
    pub t: f64,
    pub r: f64,
    pub b: f64,
}

#[cfg(windows)]
mod imp {
    use super::TopWin;
    use std::ffi::c_void;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Media::timeBeginPeriod;
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetLastInputInfo, LASTINPUTINFO, VK_LBUTTON};
    use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetCursorPos, GetWindowLongW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    /// Ask Windows for 1 ms timer resolution (the default is ~16 ms), so the frame loop really runs every
    /// ~8 ms and click-through reacts to the cursor without a noticeable delay.
    pub fn precise_timers() {
        unsafe {
            let _ = timeBeginPeriod(1);
        }
    }

    /// Seconds since the last keyboard or mouse input, system-wide.
    pub fn idle_seconds() -> f64 {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        unsafe {
            if GetLastInputInfo(&mut info).as_bool() {
                return GetTickCount().wrapping_sub(info.dwTime) as f64 / 1000.0;
            }
        }
        0.0
    }

    /// True while a fullscreen app, D3D game or presentation is in front. This is the same signal
    /// Windows uses to hold back its own notifications.
    pub fn fullscreen_active() -> bool {
        match unsafe { SHQueryUserNotificationState() } {
            Ok(s) => s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE,
            Err(_) => false,
        }
    }

    /// Cursor in physical screen pixels.
    pub fn cursor() -> (f64, f64) {
        let mut p = POINT::default();
        unsafe {
            let _ = GetCursorPos(&mut p);
        }
        (p.x as f64, p.y as f64)
    }

    pub fn left_button_down() -> bool {
        unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
    }

    /// Visible frame of a window, or None when it is hidden, minimised or cloaked (other virtual desktop).
    pub fn window_rect(hwnd: isize) -> Option<(f64, f64, f64, f64)> {
        let h = HWND(hwnd as *mut c_void);
        unsafe {
            if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
                return None;
            }
            let mut cloaked: u32 = 0;
            let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4);
            if cloaked != 0 {
                return None;
            }
            let mut r = RECT::default();
            DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut c_void, std::mem::size_of::<RECT>() as u32).ok()?;
            Some((r.left as f64, r.top as f64, r.right as f64, r.bottom as f64))
        }
    }

    const SHELL_CLASSES: [&str; 8] = [
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
        "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland", "NotifyIconOverflowWindow",
    ];

    unsafe extern "system" fn collect(h: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<TopWin>);
        let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
        if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) != 0 {
            return BOOL(1);
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return BOOL(1);
        }
        let mut buf = [0u16; 64];
        let n = GetClassNameW(h, &mut buf) as usize;
        let class = String::from_utf16_lossy(&buf[..n]);
        if SHELL_CLASSES.contains(&class.as_str()) {
            return BOOL(1);
        }
        if let Some((l, t, r, b)) = window_rect(h.0 as isize) {
            if r - l >= 160.0 && b - t >= 100.0 {
                out.push(TopWin { hwnd: h.0 as isize, l, t, r, b });
            }
        }
        BOOL(1)
    }

    /// Visible top-level windows of other apps, front-most first.
    pub fn top_windows() -> Vec<TopWin> {
        let mut out: Vec<TopWin> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut out as *mut Vec<TopWin> as isize));
        }
        out
    }
}

#[cfg(not(windows))]
mod imp {
    use super::TopWin;
    pub fn precise_timers() {}
    pub fn idle_seconds() -> f64 { 0.0 }
    pub fn fullscreen_active() -> bool { false }
    pub fn cursor() -> (f64, f64) { (0.0, 0.0) }
    pub fn left_button_down() -> bool { false }
    pub fn window_rect(_: isize) -> Option<(f64, f64, f64, f64)> { None }
    pub fn top_windows() -> Vec<TopWin> { Vec::new() }
}

pub use imp::*;
