// Windows: dölj konsolfönstret i release-bygget.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    berryit_control_center_lib::run()
}
