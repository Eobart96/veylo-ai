// This is a windowed app, including local debug builds: no extra console window.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    ari_overlay_lib::run();
}
