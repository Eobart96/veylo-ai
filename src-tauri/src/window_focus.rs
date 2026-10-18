#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowThreadProcessId(window: *mut c_void, pid: *mut u32) -> u32;
        fn IsWindow(window: *mut c_void) -> i32;
        fn SetForegroundWindow(window: *mut c_void) -> i32;
        fn GetCursorPos(point: *mut Point) -> i32;
    }
    #[repr(C)]
    struct Point { x: i32, y: i32 }
    pub fn pointer() -> Result<(i32, i32), String> {
        let mut point = Point { x:0, y:0 };
        if unsafe { GetCursorPos(&mut point) } == 0 { return Err("Не удалось определить положение мыши.".into()); }
        Ok((point.x,point.y))
    }
    pub fn capture() -> Option<(isize, u32)> {
        unsafe {
            let window = GetForegroundWindow();
            let mut pid = 0;
            GetWindowThreadProcessId(window, &mut pid);
            (!window.is_null() && pid != std::process::id()).then_some((window as isize, pid))
        }
    }
    pub fn restore(target: Option<(isize, u32)>) {
        if let Some((handle, expected_pid)) = target {
            unsafe {
                let window = handle as *mut c_void;
                let mut pid = 0;
                GetWindowThreadProcessId(window, &mut pid);
                if IsWindow(window) != 0 && pid == expected_pid && SetForegroundWindow(window) == 0 {
                    eprintln!("Windows declined foreground restore");
                }
            }
        }
    }
}
#[cfg(not(windows))]
mod platform {
    pub fn pointer() -> Result<(i32,i32),String> { Err("Режим под курсором доступен в Windows.".into()) }
    pub fn capture() -> Option<(isize, u32)> { None }
    pub fn restore(_: Option<(isize, u32)>) {}
}


pub use platform::{capture, restore, pointer};
