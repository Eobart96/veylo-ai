use serde::{Deserialize,Serialize};
use std::{sync::Mutex,path::Path,io::Write,time::{Instant,Duration}};
use tauri::{Manager,Emitter};

pub const DEFAULTS:[&str;4]=["Ctrl + Shift + Space","Alt + Q","Alt + E","Alt + W"];
const FALLBACKS:[&str;4]=["Ctrl + Alt + Space","Alt + Shift + Q","Alt + Shift + E","Alt + Shift + W"];
#[derive(Clone,Copy,Deserialize,Serialize,Debug,PartialEq)]
#[serde(rename_all="lowercase")]
pub enum Action { Overlay,Screen,Area,Cursor }
const ACTIONS:[Action;4]=[Action::Overlay,Action::Screen,Action::Area,Action::Cursor];
fn index(action:Action)->usize { ACTIONS.iter().position(|a|*a==action).unwrap() }
#[derive(Clone,Deserialize,Serialize,PartialEq,Debug)]
#[serde(deny_unknown_fields)]
struct Config { keys:[String;4] }
impl Default for Config { fn default()->Self { Self {keys:DEFAULTS.map(str::to_owned)} } }
#[derive(Default)]
struct Inner { ready:bool,revision:u64,config:Config,active:[Option<String>;4],errors:[Option<String>;4],recording:Option<Instant>,load_error:Option<String> }
#[derive(Default)]
pub struct Hotkeys(Mutex<Inner>);
#[derive(Clone,Serialize)]
pub struct Binding {action:Action,key:String,registered:bool,error:Option<String>}
#[derive(Clone,Serialize)]
pub struct View {ready:bool,revision:u64,bindings:Vec<Binding>,error:Option<String>}
impl Inner {
    fn view(&self)->View { View {ready:self.ready,revision:self.revision,bindings:ACTIONS.iter().enumerate().map(|(i,&action)|Binding{action,key:self.active[i].as_ref().unwrap_or(&self.config.keys[i]).clone(),registered:self.active[i].is_some(),error:self.errors[i].clone()}).collect(),error:self.load_error.clone()} }
}
pub fn normalize(raw:&str)->Result<String,String> {
    if raw.len()>80 {return Err("Слишком длинное сочетание.".into());}
    let mut modifiers=[false;3]; let mut key=None;
    for part in raw.split('+').map(str::trim) {
        let slot=match part.to_ascii_lowercase().as_str(){"ctrl"|"control"=>Some(0),"alt"=>Some(1),"shift"=>Some(2),_=>None};
        if let Some(i)=slot {if modifiers[i] {return Err("Модификатор указан дважды.".into());} modifiers[i]=true;continue;}
        let upper=part.to_ascii_uppercase();
        let parsed=if upper=="SPACE" {"Space".to_owned()} else if upper.len()==1 && upper.as_bytes()[0].is_ascii_alphanumeric() {upper}
            else if upper.starts_with('F') && upper[1..].parse::<u8>().is_ok_and(|n|(1..=24).contains(&n)) {format!("F{}",upper[1..].parse::<u8>().unwrap())}
            else {return Err("Используй букву, цифру, пробел или F1–F24.".into());};
        if key.replace(parsed).is_some(){return Err("Нужна одна основная клавиша.".into());}
    }
    let key=key.ok_or("Нажми основную клавишу вместе с сочетанием.")?;
    if !modifiers[0] && !modifiers[1] && !key.starts_with('F') {return Err("Добавь Ctrl или Alt, либо выбери F1–F24.".into());}
    // A letter F is not a function key.
    if !modifiers[0] && !modifiers[1] && key=="F" {return Err("Добавь Ctrl или Alt.".into());}
    let mut parts=Vec::new();for(i,name)in ["Ctrl","Alt","Shift"].iter().enumerate(){if modifiers[i]{parts.push((*name).to_owned());}}
    parts.push(key);Ok(parts.join(" + "))
}
fn load(path:&Path)->Result<Config,String>{
    if !path.exists(){return Ok(Config::default());}
    let bytes=std::fs::read(path).map_err(|_|"Не удалось прочитать горячие клавиши.")?;
    let mut config:Config=serde_json::from_slice(&bytes).map_err(|_|"Файл горячих клавиш повреждён. Используются стандартные.")?;
    for i in 0..4 {config.keys[i]=normalize(&config.keys[i])?;if config.keys[..i].contains(&config.keys[i]){return Err("В сохранённых клавишах есть повтор. Используются стандартные.".into());}}
    Ok(config)
}
fn save(path:&Path,config:&Config)->Result<(),String>{
    (||->Result<(),Box<dyn std::error::Error>>{
        let dir=path.parent().ok_or("No directory")?;std::fs::create_dir_all(dir)?;
        let mut file=tempfile::NamedTempFile::new_in(dir)?;serde_json::to_writer_pretty(&mut file,config)?;file.flush()?;file.as_file().sync_all()?;file.persist(path)?;Ok(())
    })().map_err(|_|"Не удалось сохранить горячие клавиши. Прежняя комбинация оставлена.".into())
}
// Reserve first; a conflict or failed write must not remove the working key.
fn prepare_change<F,S>(old:&Config,active:&[Option<String>;4],i:usize,key:&str,mut registry:F,mut persist:S)->Result<Config,String>
where F:FnMut(bool,&str)->Result<(),String>,S:FnMut(&Config)->Result<(),String>{
    let key=normalize(key)?;
    if (0..4).any(|j|j!=i && (old.keys[j]==key || active[j].as_deref()==Some(&key))) {return Err("Эта комбинация уже назначена другому действию Veylo AI.".into());}
    let mut next=old.clone();next.keys[i]=key.clone();
    let changed=active[i].as_deref()!=Some(&key);
    if changed {registry(true,&key).map_err(|_|"Комбинация занята другой программой или недоступна. Прежняя оставлена.".to_owned())?;}
    if let Err(error)=persist(&next){if changed {let _=registry(false,&key);}return Err(error);}
    Ok(next)
}
#[tauri::command]
pub async fn get_hotkeys(app:tauri::AppHandle)->Result<View,String>{
    tauri::async_runtime::spawn_blocking(move||Ok(app.state::<Hotkeys>().0.lock().map_err(|_|"Настройки клавиш недоступны.")?.view()))
        .await.map_err(|_|"Не удалось загрузить горячие клавиши.".to_owned())?
}
#[tauri::command]
pub fn set_hotkey_recording(app:tauri::AppHandle,window:tauri::WebviewWindow,recording:bool)->Result<(),String>{
    if window.label()!="main"{return Err("Назначение клавиш доступно в программе.".into());}
    app.state::<Hotkeys>().0.try_lock().map_err(|_|"Настройки клавиш изменяются.")?.recording=if recording{Some(Instant::now())}else{None};Ok(())
}
pub fn stop_recording(app:&tauri::AppHandle){if let Ok(mut s)=app.state::<Hotkeys>().0.try_lock(){s.recording=None;}}

#[cfg(feature="overlay")]
fn publish(app:&tauri::AppHandle,s:&Inner){
    let _=app.emit("hotkeys-changed",s.view());
    let state=app.state::<crate::status::RuntimeState>();
    let _=state.set_shortcut_result(if s.active[0].is_some(){Ok(())}else{Err(s.errors[0].clone().unwrap_or_default())},s.active[0].as_ref().unwrap_or(&s.config.keys[0]));
    let _=state.set_capture_shortcut(s.active[1].is_some(),s.active[1].as_ref().unwrap_or(&s.config.keys[1]));
    let _=state.set_cursor_shortcut(s.active[3].is_some(),s.active[3].as_ref().unwrap_or(&s.config.keys[3]));
    if let Ok(status)=state.snapshot(){let _=app.emit("app-status",status);}
}
#[cfg(feature="overlay")]
pub fn initialize(app:&tauri::AppHandle)->Result<(),String>{
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let path=app.path().app_config_dir().map_err(|e|e.to_string())?.join("hotkeys.json");
    let state=app.state::<Hotkeys>();
    let mut s=state.0.lock().map_err(|_|"Настройки клавиш недоступны.")?;
    match load(&path){Ok(config)=>s.config=config,Err(error)=>s.load_error=Some(error)}
    for i in 0..4 {
        let wanted=s.config.keys[i].clone();
        let candidates=if wanted==DEFAULTS[i]{vec![wanted,FALLBACKS[i].into()]}else{vec![wanted]};
        for key in candidates {if s.active.iter().flatten().any(|other|other==&key) || (key!=s.config.keys[i] && s.config.keys.iter().enumerate().any(|(j,wanted)|j!=i && wanted==&key)){continue;}if app.global_shortcut().register(key.as_str()).is_ok(){s.active[i]=Some(key);break;}}
        if s.active[i].is_none(){s.errors[i]=Some("Комбинация занята. Назначь другую.".into());}
        #[cfg(debug_assertions)]
        println!("HOTKEY_READY action={:?} registered={} key={}",ACTIONS[i],s.active[i].is_some(),s.active[i].as_ref().unwrap_or(&s.config.keys[i]));
    }
    s.ready=true;s.revision+=1;
    publish(app,&s);Ok(())
}
#[tauri::command]
pub async fn set_hotkey(app:tauri::AppHandle,window:tauri::WebviewWindow,action:Action,key:String)->Result<View,String>{
    if window.label()!="main"{return Err("Назначение клавиш доступно в программе.".into());}
    #[cfg(not(feature="overlay"))]
    {let _=(app,action,key);Err("Горячие клавиши недоступны в этой сборке.".into())}
    #[cfg(feature="overlay")]
    tauri::async_runtime::spawn_blocking(move||{
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let path=app.path().app_config_dir().map_err(|e|e.to_string())?.join("hotkeys.json");
        let state=app.state::<Hotkeys>();let mut s=state.0.lock().map_err(|_|"Настройки клавиш недоступны.")?;s.recording=None;
        let i=index(action);let old=s.active[i].clone();
        let next=prepare_change(&s.config,&s.active,i,&key,|register,key|{
            if register{app.global_shortcut().register(key)}else{app.global_shortcut().unregister(key)}.map_err(|e|e.to_string())
        },|config|save(&path,config))?;
        let chosen=next.keys[i].clone();s.config=next;s.active[i]=Some(chosen.clone());s.errors[i]=None;s.load_error=None;
        if let Some(old)=old.filter(|old|old!=&chosen){if app.global_shortcut().unregister(old.as_str()).is_err(){s.errors[i]=Some("Новая клавиша работает. Для освобождения старой перезапусти Veylo AI.".into());}}
        s.revision+=1;
        publish(&app,&s);Ok(s.view())
    }).await.map_err(|_|"Не удалось изменить горячую клавишу.".to_owned())?
}
#[cfg(feature="overlay")]
pub fn handle(app:&tauri::AppHandle,triggered:&tauri_plugin_global_shortcut::Shortcut,event:tauri_plugin_global_shortcut::ShortcutEvent){
    use tauri_plugin_global_shortcut::{Shortcut,ShortcutState};
    if event.state()!=ShortcutState::Pressed{return;}
    let selected={
        let state=app.state::<Hotkeys>();let Ok(s)=state.0.try_lock()else{return;};
        let Some(i)=s.active.iter().position(|key|key.as_ref().is_some_and(|key|key.parse::<Shortcut>().is_ok_and(|key|key.id()==triggered.id())))else{return;};
        if s.recording.is_some_and(|at|at.elapsed()<Duration::from_secs(30)){let _=app.emit("hotkey-recorded",s.active[i].as_ref().unwrap());return;}
        ACTIONS[i]
    };
    if crate::screen_capture::active(app){let _=crate::screen_capture::cancel(app);return;}
    if selected==Action::Overlay{let _=crate::overlay::toggle(app);return;}
    let app=app.clone();tauri::async_runtime::spawn(async move{
        let result=match selected{Action::Screen=>crate::screen_capture::start_fullscreen(app).await,Action::Area=>crate::screen_capture::start_area_shortcut(app).await,Action::Cursor=>crate::screen_capture::start_cursor_shortcut(app).await,Action::Overlay=>Ok(())};
        if let Err(error)=result{eprintln!("{error}");}
    });
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn startup_view_is_pending_until_registration_completes(){
        let mut state=Inner::default();assert!(!state.view().ready);assert_eq!(state.view().revision,0);
        state.config.keys[2]="Ctrl + Alt + R".into();state.active=state.config.keys.clone().map(Some);state.ready=true;state.revision=1;
        let view=state.view();assert!(view.ready);assert_eq!(view.revision,1);assert_eq!(view.bindings[2].key,"Ctrl + Alt + R");assert!(view.bindings.iter().all(|binding|binding.registered));
    }
    #[test]fn validates_and_normalizes_keys(){
        assert_eq!(normalize(" shift + control + q ").unwrap(),"Ctrl + Shift + Q");assert_eq!(normalize("F08").unwrap(),"F8");
        for bad in ["A","F","Shift + Q","Esc","Ctrl + Ctrl + A","Ctrl + A + B","Alt +","F25","Super + Q"]{assert!(normalize(bad).is_err(),"{bad}");}
        #[cfg(feature="overlay")]
        for key in DEFAULTS.into_iter().chain(FALLBACKS).chain(["F8","Ctrl + Alt + 1","Shift + F24","Ctrl + Space"]) {assert!(key.parse::<tauri_plugin_global_shortcut::Shortcut>().is_ok(),"{key}");}
    }
    #[test]fn saved_bindings_are_atomic_and_survive_reload(){let dir=tempfile::tempdir().unwrap();let path=dir.path().join("hotkeys.json");let mut c=Config::default();c.keys[2]="Ctrl + Alt + R".into();save(&path,&c).unwrap();assert_eq!(load(&path).unwrap(),c);c.keys[1]=c.keys[0].clone();save(&path,&c).unwrap();assert!(load(&path).is_err());assert!(save(dir.path(),&c).is_err());}
    #[test]fn occupied_duplicate_and_write_failure_preserve_old_binding(){
        let old=Config::default();let active=old.keys.clone().map(Some);let mut calls=Vec::new();
        assert!(prepare_change(&old,&active,0,"Alt + Q",|_,_|panic!("Duplicate must not register"),|_|Ok(())).is_err());
        assert!(prepare_change(&old,&active,0,"F8",|_,_|Err("Occupied".into()),|_|panic!("Conflict must not write")).is_err());
        assert!(prepare_change(&old,&active,0,"F8",|on,key|{calls.push((on,key.to_owned()));Ok(())},|_|Err("Disk".into())).is_err());
        assert_eq!(calls,[(true,"F8".into()),(false,"F8".into())]);assert_eq!(active[0].as_deref(),Some(DEFAULTS[0]));
        let next=prepare_change(&old,&active,0,"F8",|_,_|Ok(()),|_|Ok(())).unwrap();assert_eq!(next.keys[0],"F8");assert_eq!(old.keys[0],DEFAULTS[0]);
    }
}
