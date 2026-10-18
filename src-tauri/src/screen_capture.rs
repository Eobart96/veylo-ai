use crate::{overlay, screen_image, translation, window_focus};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct Capture(Mutex<Inner>);
#[derive(Default, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase { #[default] Idle, Freezing, Selecting, Translating, Result, Error }
#[derive(Default)]
struct Inner {
    busy: bool, worker: bool, reserved: bool, generation: u64, phase: Phase,
    context: Option<Context>, cancelled: Option<Arc<AtomicBool>>,
    frame: Option<Arc<screen_image::Frame>>, image: Option<String>,
    region: Option<Region>, translated: Option<String>, error: Option<String>, saved: Option<Saved>,
    blocks: Vec<ScreenBlock>,
    line_point: Option<(u32,u32)>,
    mode: crate::history::Mode,
}
impl Inner {
    fn begin(&mut self) -> Result<(u64, Arc<AtomicBool>), String> {
        if self.busy || self.context.is_some() { return Err("Сначала закрой текущий перевод клавишей Esc.".into()); }
        self.generation = self.generation.wrapping_add(1);
        self.busy = true; self.worker = true; self.reserved = true; self.phase = Phase::Freezing; self.error = None;
        self.line_point = None;
        let token = Arc::new(AtomicBool::new(false)); self.cancelled = Some(token.clone());
        Ok((self.generation, token))
    }
    fn close(&mut self) -> Option<Context> {
        if let Some(token) = &self.cancelled { token.store(true, Ordering::SeqCst); }
        self.generation = self.generation.wrapping_add(1);
        self.phase = Phase::Idle; self.busy = self.worker;
        self.frame = None; self.image = None; self.region = None; self.translated = None; self.error = None; self.blocks.clear();
        self.line_point = None;
        self.context.take()
    }
    fn accepts(&self, id: u64) -> bool { id == self.generation && self.context.is_some() }
}
#[derive(Clone, Copy, PartialEq)]
struct Monitor { x: i32, y: i32, width: u32, height: u32 }
#[derive(Clone, Copy)]
struct Context { monitor: Monitor, main_visible: bool, overlay_visible: bool, previous: Option<(isize, u32)> }
#[derive(Clone, Copy)]
struct Saved { monitor: Monitor, previous: Option<(isize, u32)>, region: Region }
impl Saved { fn matches(self, context: Context) -> bool { self.monitor == context.monitor && self.previous == context.previous } }
#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct Region { pub left: f64, pub top: f64, pub right: f64, pub bottom: f64 }
const FULL_SCREEN: Region = Region { left: 0., top: 0., right: 1., bottom: 1. };
fn pointer_context(point: (u32,u32), width:u32, height:u32, scale:f64) -> Result<Region,String> {
    if width < 8 || height < 8 || point.0 >= width || point.1 >= height || !scale.is_finite() || scale <= 0. { return Err("Мышь находится вне выбранного монитора.".into()); }
    let w = width;
    let h = ((640. * scale).round() as u32).clamp(8,height);
    let x = point.0.saturating_sub(w/2).min(width-w);
    let y = point.1.saturating_sub(h/2).min(height-h);
    Ok(Region { left:x as f64/width as f64, top:y as f64/height as f64, right:(x+w) as f64/width as f64, bottom:(y+h) as f64/height as f64 })
}
// Expansion always uses the same frozen pixels and the original pointer.
fn pointed_text_with<F>(mut rect:(u32,u32,u32,u32), point:(u32,u32), width:u32, height:u32, token:&AtomicBool, mut read:F) -> Result<(translation::ImageTranslation,(u32,u32,u32,u32)),String>
where F: FnMut((u32,u32,u32,u32),(u16,u16))->Result<translation::ImageTranslation,String> {
    let started=std::time::Instant::now();
    loop {
        if token.load(Ordering::SeqCst) { return Err("Перевод отменён.".into()); }
        let local = (((point.0 as f64-rect.0 as f64)/rect.2 as f64*1000.).clamp(0.,1000.).round() as u16,
            ((point.1 as f64-rect.1 as f64)/rect.3 as f64*1000.).clamp(0.,1000.).round() as u16);
        let mut image = read(rect,local)?;
        if token.load(Ordering::SeqCst) { return Err("Перевод отменён.".into()); }
        let block=image.blocks.first().ok_or("Текст под курсором не найден.")?;
        let clipped_top = block.top <= 15 && rect.1 > 0;
        let clipped_bottom = block.bottom >= 985 && rect.1 + rect.3 < height;
        if !clipped_top && !clipped_bottom {
            image.translation.elapsed_ms=started.elapsed().as_millis();
            return Ok((image,rect));
        }
        let padding=rect.3;
        let top=if clipped_top { rect.1.saturating_sub(padding) } else { rect.1 };
        let bottom=if clipped_bottom { rect.1.saturating_add(rect.3).saturating_add(padding).min(height) } else { rect.1+rect.3 };
        rect=(0,top,width,bottom-top);
    }
}
fn initial_region(full_screen: bool, remembered: Option<Region>) -> Option<Region> {
    if full_screen { Some(FULL_SCREEN) } else { remembered }
}
#[derive(Clone, Serialize)]
pub struct Status { phase: Phase, busy: bool, generation: u64, region: Option<Region>, translated: Option<String>, error: Option<String>, blocks: Vec<ScreenBlock> }
#[derive(Clone, Serialize)]
pub struct ScreenBlock { region: Region, source: String, translation: String }
fn place_blocks(blocks: &[translation::ImageBlock], rect: (u32, u32, u32, u32), monitor: Monitor) -> Vec<ScreenBlock> {
    blocks.iter().map(|block| ScreenBlock {
        region: Region {
            left: (rect.0 as f64 + f64::from(block.left) / 1000. * rect.2 as f64) / monitor.width as f64,
            top: (rect.1 as f64 + f64::from(block.top) / 1000. * rect.3 as f64) / monitor.height as f64,
            right: (rect.0 as f64 + f64::from(block.right) / 1000. * rect.2 as f64) / monitor.width as f64,
            bottom: (rect.1 as f64 + f64::from(block.bottom) / 1000. * rect.3 as f64) / monitor.height as f64,
        }, source: block.source.clone(), translation: block.translation.clone(),
    }).collect()
}
#[derive(Serialize)]
pub struct FrozenFrame { generation: u64, image: String }

fn pixels(region: Region, width: u32, height: u32) -> Result<(u32, u32, u32, u32), String> {
    if width == 0 || height == 0 || ![region.left, region.top, region.right, region.bottom].iter().all(|v| v.is_finite() && (0. ..=1.).contains(v)) || region.right <= region.left || region.bottom <= region.top { return Err("Выдели прямоугольную область с текстом.".into()); }
    let x = (region.left * width as f64).floor() as u32; let y = (region.top * height as f64).floor() as u32;
    let w = (region.right * width as f64).ceil() as u32 - x; let h = (region.bottom * height as f64).ceil() as u32 - y;
    if w < 8 || h < 8 || w > 8192 || h > 8192 || u64::from(w) * u64::from(h) > 16_000_000 { return Err("Область: минимум 8 пикселей, максимум 8192 по стороне и 16 млн пикселей.".into()); }
    Ok((x, y, w, h))
}
pub fn active(app: &tauri::AppHandle) -> bool { app.state::<Capture>().0.lock().map(|s| s.context.is_some() || s.phase == Phase::Freezing).unwrap_or(true) }
#[tauri::command]
pub fn screen_capture_status(app: tauri::AppHandle) -> Result<Status, String> {
    let state = app.state::<Capture>(); let s = state.0.lock().map_err(|e| e.to_string())?;
    Ok(Status { phase: s.phase, busy: s.busy, generation: s.generation, region: s.region, translated: s.translated.clone(), error: s.error.clone(), blocks: s.blocks.clone() })
}
#[tauri::command]
pub fn screen_capture_frame(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<FrozenFrame>, String> {
    if window.label() != "backdrop" { return Err("Frame belongs to backdrop only".into()); }
    let state = app.state::<Capture>(); let s = state.0.lock().map_err(|e| e.to_string())?;
    Ok(s.image.as_ref().map(|image| FrozenFrame { generation: s.generation, image: image.clone() }))
}
fn publish(app: &tauri::AppHandle) { if let Ok(status) = screen_capture_status(app.clone()) { let _ = app.emit("screen-capture-state", status); } }
fn release(app: &tauri::AppHandle, state: &mut Inner) {
    if state.reserved { app.state::<translation::Translator>().0.store(false, Ordering::SeqCst); state.reserved = false; }
}
fn restore(app: &tauri::AppHandle, context: Context) -> Result<(), String> {
    if let Some(backdrop) = app.get_webview_window("backdrop") { backdrop.hide().map_err(|e| e.to_string())?; }
    if context.main_visible { if let Some(main) = app.get_webview_window("main") { main.show().map_err(|e| e.to_string())?; } }
    overlay::resume_widget_after_capture(app, context.overlay_visible)?;
    window_focus::restore(context.previous); Ok(())
}
pub fn cancel(app: &tauri::AppHandle) -> Result<(), String> {
    let context = {
        let state = app.state::<Capture>(); let mut s = state.0.lock().map_err(|e| e.to_string())?;
        let context = s.close(); if !s.worker { release(app, &mut s); } context
    };
    if let Some(context) = context { restore(app, context)?; }
    publish(app); Ok(())
}
#[tauri::command]
pub fn cancel_screen_capture(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "backdrop" && window.label() != "overlay" { return Err("Capture window only".into()); }
    cancel(&app)
}
// A late completion after Esc may release its reservation, but never reopen UI.
fn fail(app: &tauri::AppHandle, id: u64, error: String) {
    let mut context = None;
    let mut show_main = false;
    if let Ok(mut s) = app.state::<Capture>().0.lock() {
        s.worker = false; s.busy = false;
        release(app, &mut s);
        if s.generation == id {
            s.error = Some(error);
            if s.frame.is_some() { s.phase = Phase::Error; }
            else { s.phase = Phase::Idle; context = s.context.take(); show_main = true; }
        }
    }
    if let Some(context) = context { let _ = restore(app, context); }
    if show_main { let _ = overlay::show_main(app.clone()); }
    publish(app);
}

#[tauri::command]
pub async fn start_screen_capture(app: tauri::AppHandle, window: tauri::WebviewWindow, full_screen: Option<bool>) -> Result<(), String> {
    if window.label() != "overlay" { return Err("Выделение запускается из переводчика.".into()); }
    start_mode(app, false, full_screen.unwrap_or(false), None).await
}
#[tauri::command]
pub async fn start_cursor_line(app:tauri::AppHandle, window:tauri::WebviewWindow) -> Result<(),String> {
    if window.label() != "overlay" { return Err("Режим строки запускается из переводчика.".into()); }
    start_mode(app,false,false,Some(true)).await
}
pub async fn start_cursor_shortcut(app:tauri::AppHandle) -> Result<(),String> { start_mode(app,false,false,Some(false)).await }
pub async fn start_area_shortcut(app:tauri::AppHandle)->Result<(),String>{start_mode(app,false,false,None).await}
pub async fn start_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    // The global key always translates a fresh full monitor, never a saved crop.
    start_mode(app, false, true, None).await
}
async fn start_mode(app: tauri::AppHandle, reuse: bool, full_screen: bool, cursor_delay:Option<bool>) -> Result<(), String> {
    let (id, token) = {
        let state = app.state::<Capture>(); let mut s = state.0.lock().map_err(|e| e.to_string())?;
        if s.busy || s.context.is_some() { return Err("Закрой текущий перевод клавишей Esc.".into()); }
        translation::acquire(&app.state::<translation::Translator>())?; s.begin()?
    };
    if cursor_delay == Some(true) {
        publish(&app);
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_secs(2))).await;
    }
    if token.load(Ordering::SeqCst) { fail(&app,id,"Перевод отменён.".into()); return Ok(()); }
    let pointer = if cursor_delay.is_some() { match window_focus::pointer() { Ok(point)=>Some(point), Err(error)=>{ fail(&app,id,error.clone()); return Err(error); } } } else { None };
    let prepared = (|| -> Result<(Context, Option<Region>), String> {
        let panel = app.get_webview_window("overlay").ok_or("Overlay unavailable")?;
        let m = if let Some((x,y)) = pointer {
            panel.available_monitors().map_err(|e|e.to_string())?.into_iter().find(|m| {
                let p=m.position(); let s=m.size(); x as i64 >= p.x as i64 && (x as i64) < p.x as i64+s.width as i64 && y as i64 >= p.y as i64 && (y as i64) < p.y as i64+s.height as i64
            }).ok_or("Монитор под мышью не найден")?
        } else { panel.current_monitor().map_err(|e|e.to_string())?.ok_or("Монитор не найден")? };
        let main = app.get_webview_window("main").ok_or("Main unavailable")?;
        let monitor = Monitor { x: m.position().x, y: m.position().y, width: m.size().width, height: m.size().height };
        let local_pointer = pointer.map(|(x,y)| ((x as i64-monitor.x as i64) as u32,(y as i64-monitor.y as i64) as u32));
        let mut context = Context { monitor, main_visible: main.is_visible().map_err(|e| e.to_string())?, overlay_visible: panel.is_visible().map_err(|e| e.to_string())?, previous: window_focus::capture() };
        {
            let state = app.state::<Capture>(); let mut s = state.0.lock().map_err(|e| e.to_string())?;
            if s.generation != id || s.phase != Phase::Freezing { return Err("Выделение отменено.".into()); }
            s.context = Some(context);
            s.line_point = local_pointer;
            s.mode=if cursor_delay.is_some(){crate::history::Mode::Cursor}else if full_screen{crate::history::Mode::Screen}else{crate::history::Mode::Area};
        }
        overlay::prepare_capture_windows(&app)?;
        overlay::hide_overlay(app.clone())?; main.hide().map_err(|e| e.to_string())?;
        context.previous = context.previous.or_else(window_focus::capture);
        let backdrop = app.get_webview_window("backdrop").ok_or("Backdrop unavailable")?;
        backdrop.set_position(*m.position()).map_err(|e| e.to_string())?; backdrop.set_size(*m.size()).map_err(|e| e.to_string())?;
        let state = app.state::<Capture>(); let mut s = state.0.lock().map_err(|e| e.to_string())?;
        if !s.accepts(id) { drop(s); let _ = restore(&app, context); return Err("Выделение отменено.".into()); }
        s.context = Some(context);
        let remembered = if reuse { s.saved.filter(|saved| saved.matches(context)).map(|saved| saved.region) } else { None };
        let region = if let Some(point)=local_pointer { Some(pointer_context(point,monitor.width,monitor.height,m.scale_factor())?) } else { initial_region(full_screen, remembered) };
        Ok((context, region))
    })();
    let (context, remembered) = match prepared { Ok(value) => value, Err(error) => { fail(&app, id, error.clone()); return Err(error); } };
    publish(&app);
    let cancelled = token.clone(); let monitor = context.monitor;
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(debug_assertions)]
        let started = std::time::Instant::now();
        if cancelled.load(Ordering::SeqCst) { return Err("Выделение отменено.".to_owned()); }
        let frame = screen_image::capture_frame(monitor.x, monitor.y, monitor.width as i32, monitor.height as i32, &cancelled)?;
        #[cfg(debug_assertions)]
        let captured_ms = started.elapsed().as_millis();
        if cancelled.load(Ordering::SeqCst) { return Err("Выделение отменено.".to_owned()); }
        let image = frame.data_url()?;
        #[cfg(debug_assertions)]
        println!("CAPTURE_PREPARED capture_ms={captured_ms} preview_ms={}", started.elapsed().as_millis().saturating_sub(captured_ms));
        Ok((Arc::new(frame), image))
    }).await.map_err(|_| "Не удалось зафиксировать кадр.".to_owned()).and_then(|r| r);
    let (frame, image) = match snapshot { Ok(value) => value, Err(error) => { fail(&app, id, error); return Ok(()); } };
    {
        let state = app.state::<Capture>(); let mut s = state.0.lock().map_err(|e| e.to_string())?;
        if !s.accepts(id) { drop(s); fail(&app, id, "Выделение отменено.".into()); return Ok(()); }
        s.frame = Some(frame); s.image = Some(image);
    }
    let shown = (|| -> Result<(), String> { let window = app.get_webview_window("backdrop").ok_or("Backdrop unavailable")?; window.show().map_err(|e| e.to_string())?; window.set_focus().map_err(|e| e.to_string()) })();
    if let Err(error) = shown { let _ = cancel(&app); fail(&app, id, error.clone()); return Err(error); }
    {
        let state = app.state::<Capture>(); let mut s = state.0.lock().map_err(|e| e.to_string())?;
        if !s.accepts(id) { drop(s); let _ = restore(&app, context); fail(&app, id, "Выделение отменено.".into()); return Ok(()); }
        s.worker = false; s.phase = Phase::Selecting;
    }
    if let Some(region) = remembered { finish(app, region, id).await?; }
    else { publish(&app); }
    Ok(())
}

#[tauri::command]
pub async fn finish_screen_capture(app: tauri::AppHandle, window: tauri::WebviewWindow, region: Region, generation: u64) -> Result<(), String> {
    if window.label() != "backdrop" { return Err("Capture window only".into()); }
    finish(app, region, generation).await
}
async fn finish(app: tauri::AppHandle, region: Region, generation: u64) -> Result<(), String> {
    let context = {
        let state = app.state::<Capture>(); let s = state.0.lock().map_err(|e| e.to_string())?;
        if s.phase != Phase::Selecting || !s.accepts(generation) { return Err("Выделение устарело. Повтори его на новом кадре.".into()); }
        s.context.ok_or("Нет активного монитора")?
    };
    // Native getters run outside the state mutex: closing the window must not
    // deadlock its event thread while an IPC request waits for geometry.
    let window = app.get_webview_window("backdrop").ok_or("Backdrop unavailable")?;
    let p = window.outer_position().map_err(|e| e.to_string())?; let size = window.inner_size().map_err(|e| e.to_string())?;
    if (p.x, p.y, size.width, size.height) != (context.monitor.x, context.monitor.y, context.monitor.width, context.monitor.height) { return Err("Монитор изменился. Нажми Esc и повтори выделение.".into()); }
    let rect = pixels(region, context.monitor.width, context.monitor.height)?;
    let (id, frame, token, rect, line_point, mode) = {
        let state = app.state::<Capture>(); let mut s = state.0.lock().map_err(|e| e.to_string())?;
        if s.phase != Phase::Selecting || !s.accepts(generation) { return Err("Выделение уже закрыто.".into()); }
        let frame = s.frame.clone().ok_or("Кадр не загружен")?; let token = s.cancelled.clone().ok_or("Нет запроса")?;
        s.region = Some(region); s.saved = Some(Saved { monitor: context.monitor, previous: context.previous, region }); s.phase = Phase::Translating; s.worker = true;
        (s.generation, frame, token, rect, s.line_point, s.mode)
    };
    publish(&app);
    let result = tauri::async_runtime::spawn_blocking(move || {
        if let Some(point)=line_point {
            pointed_text_with(rect,point,frame.width,frame.height,&token,|area,local| {
                let png=frame.crop(area.0,area.1,area.2,area.3)?;
                translation::translate_line_cancellable(&png,local,Some(&token))
            })
        } else {
            let png = frame.crop(rect.0, rect.1, rect.2, rect.3)?;
            translation::translate_image_cancellable(&png, Some(&token)).map(|image|(image,rect))
        }
    }).await.map_err(|_| "Ошибка перевода снимка.".to_owned()).and_then(|r| r);
    let (image,rect) = match result { Ok(image) => image, Err(error) => { fail(&app, id, error); return Ok(()); } };
    let snapshot;
    {
        let state = app.state::<Capture>(); let mut s = state.0.lock().map_err(|e| e.to_string())?;
        if !s.accepts(id) { drop(s); fail(&app, id, "Перевод отменён.".into()); return Ok(()); }
        s.busy = false; s.worker = false; s.phase = Phase::Result; s.translated = Some(image.translation.text.clone());
        s.blocks = place_blocks(&image.blocks, rect, context.monitor);
        let session = app.state::<crate::session::Session>();
        let committed = session.begin(image.source.clone(), image.translation.direction).and_then(|_| session.finish(image.translation.direction, &Ok(image.translation.clone())));
        snapshot = match committed { Ok(snapshot) => snapshot, Err(error) => { drop(s); fail(&app, id, error); return Ok(()); } };
        release(&app, &mut s);
    }
    let _ = app.state::<crate::status::RuntimeState>().set_ai_connected(true);
    crate::history::record(&app,mode,image.blocks.iter().map(|block|block.source.as_str()).collect::<Vec<_>>().join("\n\n"),&image.translation);
    let _ = app.emit("translation-state", snapshot); let _ = app.emit_to("overlay", "screen-result", image); publish(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pointed_image(top:u16,bottom:u16)->translation::ImageTranslation {
        translation::ImageTranslation {
            source:"Long text\nContinuation".into(),source_truncated:false,
            translation:translation::Translation {text:"Полный текст\nПродолжение".into(),direction:translation::Direction::AutoToRussian,elapsed_ms:0},
            blocks:vec![translation::ImageBlock {source:"Long text\nContinuation".into(),translation:"Полный текст\nПродолжение".into(),left:200,top,right:800,bottom}],
        }
    }
    #[test]
    fn pointer_block_expands_frozen_crop_and_recalculates_pointer() {
        let token=AtomicBool::new(false); let mut calls=Vec::new();
        let (_,area)=pointed_text_with((0,400,2560,640),(1280,700),2560,1440,&token,|area,point| {
            calls.push((area,point));
            Ok(if calls.len()==1 {pointed_image(0,1000)} else {pointed_image(200,800)})
        }).unwrap();
        assert_eq!(calls.len(),2);
        assert_eq!(calls[0].1,(500,469));
        assert_eq!(calls[1].1,(500,486));
        assert_eq!(area,(0,0,2560,1440));
        let (_,area)=pointed_text_with((0,400,2560,640),(1280,700),2560,1440,&token,|_,_|Ok(pointed_image(100,900))).unwrap();
        assert_eq!(area,(0,400,2560,640));
    }
    #[test]
    fn pointer_block_stops_at_screen_edges_and_honours_cancellation() {
        let token=AtomicBool::new(false); let mut count=0;
        let (_,area)=pointed_text_with((0,300,2560,640),(1280,700),2560,1440,&token,|_,_|{count+=1;Ok(pointed_image(0,1000))}).unwrap();
        assert_eq!(area,(0,0,2560,1440)); assert_eq!(count,2);
        count=0;
        assert!(pointed_text_with((0,300,2560,640),(1280,700),2560,1440,&token,|_,_|{count+=1;token.store(true,Ordering::SeqCst);Ok(pointed_image(0,1000))}).is_err());
        assert_eq!(count,1);
        assert!(pointed_text_with((0,300,2560,640),(1280,700),2560,1440,&token,|_,_|panic!("Cancelled request must not run")).is_err());
        let token=AtomicBool::new(false);
        assert!(pointed_text_with((0,300,2560,640),(1280,700),2560,1440,&token,|_,_|Err("No text".into())).is_err());
    }
    #[test]
    fn pointer_context_clamps_at_monitor_edges_and_preserves_pointer() {
        for point in [(0,0),(2559,0),(0,1439),(2559,1439),(1280,720)] {
            let region=pointer_context(point,2560,1440,1.).unwrap();
            let (x,y,w,h)=pixels(region,2560,1440).unwrap();
            assert!(x<=point.0 && point.0<x+w && y<=point.1 && point.1<y+h);
            assert_eq!(w,2560); assert!(h>=640 && h<=641);
        }
        assert!(pointer_context((2560,0),2560,1440,1.).is_err());
        assert!(pointer_context((0,0),2560,1440,f64::NAN).is_err());
        let (x,y,w,h)=pixels(pointer_context((40,40),320,240,2.).unwrap(),320,240).unwrap();
        assert_eq!((x,y,w,h),(0,0,320,240));
    }
    #[test]
    fn text_boxes_map_from_crop_to_monitor_coordinates() {
        let block = translation::ImageBlock { source: "Play".into(), translation: "Играть".into(), left:100, top:250, right:500, bottom:750 };
        let mapped = place_blocks(&[block], (200,100,800,400), Monitor { x:-2000,y:0,width:2000,height:1000 });
        let region = mapped[0].region;
        assert!((region.left - 0.14).abs() < 1e-8);
        assert!((region.top - 0.2).abs() < 1e-8);
        assert!((region.right - 0.3).abs() < 1e-8);
        assert!((region.bottom - 0.4).abs() < 1e-8);
    }
    #[test]
    fn full_screen_uses_complete_frame_and_overrides_remembered_region() {
        let region = Region { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 };
        let full = initial_region(true, Some(region)).unwrap();
        assert_eq!(pixels(full, 3840, 2160).unwrap(), (0, 0, 3840, 2160));
        assert_eq!(pixels(full, 2560, 1440).unwrap(), (0, 0, 2560, 1440));
        assert!(initial_region(false, None).is_none());
        assert_eq!(initial_region(false, Some(region)).unwrap().left, 0.1);
        assert!(pixels(full, 8000, 4000).is_err());
    }
    #[test]
    fn native_crop_rejects_invalid_bounds_and_maps_scaled_frame() {
        let r = Region { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 };
        assert_eq!(pixels(r, 2000, 1000).unwrap(), (200, 200, 800, 400));
        for invalid in [Region { left: f64::NAN, ..r }, Region { right: 1.1, ..r }, Region { right: 0., ..r }, Region { right: 0.101, ..r }] { assert!(pixels(invalid, 2000, 1000).is_err()); }
    }
    #[test]
    fn escape_invalidates_late_results_and_preserves_only_session_region() {
        let mut s = Inner::default(); let (id, token) = s.begin().unwrap(); assert!(s.begin().is_err());
        let monitor = Monitor { x: -1920, y: 0, width: 1920, height: 1080 };
        s.context = Some(Context { monitor, main_visible: false, overlay_visible: true, previous: None });
        s.saved = Some(Saved { monitor, previous: None, region: Region { left: 0., top: 0., right: 0.5, bottom: 0.5 } });
        assert!(s.accepts(id)); s.close(); assert!(!s.accepts(id)); assert!(token.load(Ordering::SeqCst));
        assert!(s.saved.is_some()); assert!(s.frame.is_none() && s.image.is_none());
        assert!(s.begin().is_err(), "Do not overlap with the cancelled worker");
        s.worker = false; s.busy = false; assert!(s.begin().is_ok());
    }
    #[test]
    fn repeat_region_requires_same_monitor_geometry_and_foreground_window() {
        let monitor = Monitor { x: -1920, y: 0, width: 1920, height: 1080 };
        let context = Context { monitor, main_visible: false, overlay_visible: false, previous: Some((123, 456)) };
        let saved = Saved { monitor, previous: context.previous, region: Region { left: 0., top: 0., right: 0.5, bottom: 0.5 } };
        assert!(saved.matches(context));
        assert!(!saved.matches(Context { previous: Some((124, 456)), ..context }));
        assert!(!saved.matches(Context { monitor: Monitor { width: 1280, ..monitor }, ..context }));
    }
}
