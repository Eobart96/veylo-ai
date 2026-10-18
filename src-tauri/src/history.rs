//! Local text-only history. A FIFO worker keeps disk I/O off the UI/capture path.
use serde::{Deserialize,Serialize};
use std::{io::Write,path::{Path,PathBuf},sync::{Mutex,mpsc},time::{SystemTime,UNIX_EPOCH}};
use tauri::{Manager,Emitter};
const MAX_ENTRIES:usize=500;
const MAX_BYTES:u64=8*1024*1024;
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64}
#[derive(Clone,Copy,Serialize,Deserialize,Debug,PartialEq)]
#[serde(rename_all="lowercase")]
pub enum Mode{Text,Screen,Area,Cursor}
impl Default for Mode{fn default()->Self{Self::Area}}
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Entry{pub id:u64,pub created_at_ms:u64,pub mode:Mode,pub direction:crate::translation::Direction,pub source:String,pub translation:String,pub elapsed_ms:u128}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Data{schema_version:u8,enabled:bool,entries:Vec<Entry>}
impl Default for Data{fn default()->Self{Self{schema_version:1,enabled:true,entries:Vec::new()}}}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Snapshot{revision:u64,enabled:bool,entries:Vec<Entry>,error:Option<String>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Reply{snapshot:Snapshot,export_path:Option<String>}
#[derive(Deserialize)]
#[serde(tag="type",rename_all="camelCase",deny_unknown_fields)]
pub enum Action{Read,SetEnabled{enabled:bool},Remove{id:u64},Clear,Export}
enum Job{Append(Entry),Action(Action,mpsc::SyncSender<Result<Reply,String>>)}
#[derive(Default)]
pub struct History(Mutex<Option<mpsc::Sender<Job>>>);
struct Store{data:Data,path:PathBuf,revision:u64,error:Option<String>,blocked:bool}
fn valid(entry:&Entry)->bool{entry.id<9_007_199_254_740_991&&entry.created_at_ms<9_007_199_254_740_991&&entry.elapsed_ms<=u64::MAX as u128&&!entry.source.trim().is_empty()&&!entry.translation.trim().is_empty()&&entry.source.chars().count()<=24000&&entry.translation.chars().count()<=24000}
impl Store{
    fn load(path:PathBuf)->Self{
        let loaded=(||->Result<Data,String>{
            match std::fs::metadata(&path){Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Data::default()),Err(_)=>return Err("Не удалось открыть историю.".into()),Ok(meta)if meta.len()>MAX_BYTES=>return Err("Файл истории слишком большой.".into()),_=>{}}
            let bytes=std::fs::read(&path).map_err(|_|"Не удалось прочитать историю.")?;
            let data:Data=serde_json::from_slice(&bytes).map_err(|_|"Файл истории повреждён.")?;
            let mut ids=std::collections::HashSet::new();
            if data.schema_version!=1||data.entries.len()>MAX_ENTRIES||data.entries.iter().any(|entry|!valid(entry)||!ids.insert(entry.id)){return Err("Файл истории имеет неподдерживаемый формат.".into());}Ok(data)
        })();
        match loaded{Ok(data)=>Self{data,path,revision:0,error:None,blocked:false},Err(error)=>Self{data:Data{enabled:false,..Data::default()},path,revision:0,error:Some(format!("{error} Сохранение приостановлено. Файл оставлен без изменений; для новой истории используй «Очистить».")),blocked:true}}
    }
    fn snapshot(&self)->Snapshot{Snapshot{revision:self.revision,enabled:self.data.enabled,entries:self.data.entries.clone(),error:self.error.clone()}}
    fn commit(&mut self,next:Data)->Result<(),String>{
        let result=(||->Result<(),Box<dyn std::error::Error>>{
            let bytes=serde_json::to_vec(&next)?;if bytes.len()as u64>MAX_BYTES{return Err("History limit".into());}
            let parent=self.path.parent().ok_or("No directory")?;std::fs::create_dir_all(parent)?;
            let mut file=tempfile::NamedTempFile::new_in(parent)?;file.write_all(&bytes)?;file.flush()?;file.as_file().sync_all()?;file.persist(&self.path)?;Ok(())
        })();
        if result.is_err(){self.error=Some("Не удалось сохранить историю. Перевод готов, но запись не сохранена.".into());self.revision+=1;return Err(self.error.clone().unwrap());}
        self.data=next;self.blocked=false;self.error=None;self.revision+=1;Ok(())
    }
    fn append(&mut self,mut entry:Entry)->Result<(),String>{
        if self.blocked{return Err(self.error.clone().unwrap_or_default());}
        if !self.data.enabled{return Ok(());}
        if !valid(&entry){return Err("Перевод не сохранён: слишком большой или пустой текст.".into());}
        entry.id=self.data.entries.iter().map(|e|e.id).max().unwrap_or(0).checked_add(1).filter(|id|*id<9_007_199_254_740_991).ok_or("Не удалось создать номер записи истории.")?.max(now());
        let mut next=self.data.clone();next.entries.push(entry);
        while next.entries.len()>MAX_ENTRIES || serde_json::to_vec(&next).map_err(|_|"Не удалось подготовить историю.")?.len()as u64>MAX_BYTES {next.entries.remove(0);}
        self.commit(next)
    }
    fn action(&mut self,action:Action,exports:&Path)->Result<Reply,String>{
        let mut export_path=None;
        match action{
            Action::Read=>{},
            Action::Clear=>self.commit(Data{enabled:self.data.enabled,..Data::default()})?,
            Action::SetEnabled{enabled}=>{
                if self.blocked{return Err(self.error.clone().unwrap_or_default());}
                let mut next=self.data.clone();next.enabled=enabled;
                // A failed settings write must never keep collecting against
                // the user's explicit request to stop in this session.
                if !enabled {self.data.enabled=false;}
                if let Err(error)=self.commit(next){
                    if !enabled{self.error=Some("История отключена в этом запуске. Настройку не удалось записать; после перезапуска проверь переключатель.".into());return Err(self.error.clone().unwrap());}
                    return Err(error);
                }
            },
            Action::Remove{id}=>{if self.blocked{return Err(self.error.clone().unwrap_or_default());}let mut next=self.data.clone();next.entries.retain(|e|e.id!=id);self.commit(next)?;},
            Action::Export=>{
                if self.blocked{return Err(self.error.clone().unwrap_or_default());}
                if self.data.entries.is_empty(){return Err("История пока пуста.".into());}
                let bytes=serde_json::to_vec_pretty(&serde_json::json!({"schemaVersion":1,"exportedAtMs":now(),"entries":self.data.entries})).map_err(|_|"Не удалось подготовить выгрузку.")?;
                std::fs::create_dir_all(exports).map_err(|_|"Не удалось открыть папку для выгрузки.")?;
                for suffix in 0..100{
                    let path=exports.join(format!("translation-history-{}-{suffix}.json",now()));
                    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path){
                        Ok(mut file)=>{if file.write_all(&bytes).and_then(|_|file.sync_all()).is_err(){drop(file);let _=std::fs::remove_file(&path);return Err("Не удалось записать выгрузку.".into());}export_path=Some(path.to_string_lossy().into_owned());break;},
                        Err(e)if e.kind()==std::io::ErrorKind::AlreadyExists=>continue,
                        Err(_)=>return Err("Не удалось создать файл выгрузки.".into()),
                    }
                }
                if export_path.is_none(){return Err("Не удалось подобрать имя файла выгрузки.".into());}
            }
        }
        Ok(Reply{snapshot:self.snapshot(),export_path})
    }
}
pub fn initialize(app:&tauri::AppHandle)->Result<(),String>{
    let path=app.path().app_config_dir().map_err(|_|"Каталог истории недоступен.")?.join("translation-history.json");
    // Export is available only after an explicit UI command.
    let exports=app.path().download_dir().ok().map(|dir|dir.join("Veylo AI"));
    let(tx,rx)=mpsc::channel();*app.state::<History>().0.lock().map_err(|_|"История недоступна.")?=Some(tx);
    let app=app.clone();std::thread::spawn(move||{
        let mut store=Store::load(path);
        for job in rx{
            match job{
                Job::Append(entry)=>{if let Err(error)=store.append(entry){let _=app.emit_to("main","history-warning",error);}let _=app.emit_to("main","history-changed",());},
                Job::Action(action,reply)=>{
                    let is_export=matches!(action,Action::Export);
                    let result=if is_export&&exports.is_none(){Err("Папка «Загрузки» недоступна.".into())}else{store.action(action,exports.as_deref().unwrap_or(Path::new("")))};
                    let _=reply.send(result);
                }
            }
        }
    });Ok(())
}
pub fn record(app:&tauri::AppHandle,mode:Mode,source:String,result:&crate::translation::Translation){
    let entry=Entry{id:0,created_at_ms:now(),mode,direction:result.direction,source,translation:result.text.clone(),elapsed_ms:result.elapsed_ms};
    let state=app.state::<History>();
    let sent=state.0.lock().ok().and_then(|tx|tx.as_ref().map(|tx|tx.send(Job::Append(entry)).is_ok())).unwrap_or(false);
    if !sent{let _=app.emit_to("main","history-warning","История недоступна. Перевод не сохранён.");}
}
pub fn flush(app:&tauri::AppHandle)->Result<(),String>{
    let(tx,rx)=mpsc::sync_channel(1);
    app.state::<History>().0.lock().map_err(|_|"История недоступна.")?.as_ref().ok_or("История недоступна.")?.send(Job::Action(Action::Read,tx)).map_err(|_|"История недоступна.")?;
    rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_|"История не успела завершить сохранение.".to_owned())??;Ok(())
}
#[tauri::command]
pub async fn history_action(app:tauri::AppHandle,window:tauri::WebviewWindow,action:Action)->Result<Reply,String>{
    if window.label()!="main"{return Err("История доступна в главном окне программы.".into());}
    let(tx,rx)=mpsc::sync_channel(1);
    app.state::<History>().0.lock().map_err(|_|"История недоступна.")?.as_ref().ok_or("История недоступна.")?.send(Job::Action(action,tx)).map_err(|_|"История недоступна.")?;
    tauri::async_runtime::spawn_blocking(move||rx.recv().map_err(|_|"История недоступна.".to_owned())?).await.map_err(|_|"Не удалось открыть историю.".to_owned())?
}

#[cfg(test)]
mod tests{
    use super::*;
    fn entry()->Entry{Entry{id:0,created_at_ms:now(),mode:Mode::Cursor,direction:crate::translation::Direction::AutoToRussian,source:"Find iron".into(),translation:"Найди железо".into(),elapsed_ms:42}}
    #[test]fn history_survives_restart_disable_delete_and_export(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("history.json");let exports=dir.path().join("exports");let mut store=Store::load(path.clone());
        for mode in [Mode::Text,Mode::Screen,Mode::Area,Mode::Cursor]{let mut e=entry();e.mode=mode;store.append(e).unwrap();}
        let id=store.data.entries[0].id;assert_eq!(Store::load(path.clone()).data.entries.len(),4);
        store.action(Action::SetEnabled{enabled:false},&exports).unwrap();store.append(entry()).unwrap();assert_eq!(store.data.entries.len(),4);
        store.action(Action::Remove{id},&exports).unwrap();assert_eq!(store.data.entries.len(),3);
        let file=store.action(Action::Export,&exports).unwrap().export_path.unwrap();let exported:serde_json::Value=serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();assert_eq!(exported["entries"].as_array().unwrap().len(),3);assert_eq!(exported["entries"][0]["source"],"Find iron");
        store.action(Action::Clear,&exports).unwrap();let loaded=Store::load(path);assert!(loaded.data.entries.is_empty());assert!(!loaded.data.enabled);
    }
    #[test]fn corruption_and_failed_write_preserve_existing_file(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("history.json");std::fs::write(&path,b"broken").unwrap();let mut store=Store::load(path.clone());assert!(store.blocked);assert!(store.append(entry()).is_err());assert_eq!(std::fs::read(&path).unwrap(),b"broken");
        store.action(Action::Clear,dir.path()).unwrap();assert!(!store.blocked);assert!(!store.data.enabled);
        let mut store=Store::load(dir.path().to_owned());assert!(store.commit(Data::default()).is_err());assert!(store.data.entries.is_empty());
        store.blocked=false;store.data.enabled=true;
        assert!(store.action(Action::SetEnabled{enabled:false},dir.path()).is_err());
        assert!(!store.data.enabled);assert!(store.append(entry()).is_ok());assert!(store.data.entries.is_empty());
    }
    #[test]fn retention_limits_and_invalid_records(){
        let dir=tempfile::tempdir().unwrap();let mut store=Store::load(dir.path().join("history.json"));
        store.data.entries=(0..MAX_ENTRIES).map(|i|{let mut e=entry();e.id=i as u64+1;e}).collect();store.append(entry()).unwrap();assert_eq!(store.data.entries.len(),MAX_ENTRIES);assert_eq!(store.data.entries[0].id,2);
        let mut invalid=entry();invalid.source.clear();assert!(store.append(invalid).is_err());
        let mut big=entry();big.source="Ж".repeat(24000);big.translation="Я".repeat(24000);store.data.entries.clear();
        for _ in 0..100{store.append(big.clone()).unwrap();}assert!(std::fs::metadata(&store.path).unwrap().len()<=MAX_BYTES);assert!(store.data.entries.len()<100);
    }
}
