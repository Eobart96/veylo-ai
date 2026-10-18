import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {native,copyText} from "./bridge";
import {filterHistory,directionLabel,MODE_NAMES,type HistoryReply,type HistorySnapshot} from "./history";
let root:HTMLElement|null=null,view:HistorySnapshot|null=null,query="",limit=40,pending=false,message="",clearArmed=false;
let searchTimer:ReturnType<typeof setTimeout>|undefined;
function accept(reply:HistoryReply):void{if(!view || reply.snapshot.revision>=view.revision)view=reply.snapshot;render();}
async function action(payload:object):Promise<void>{
  if(pending)return;pending=true;message="";render();
  try{const reply=await invoke<HistoryReply>("history_action",{action:payload});accept(reply);if(reply.exportPath)message=`Сохранено: ${reply.exportPath}`;}
  catch(error){message=String(error);try{accept(await invoke<HistoryReply>("history_action",{action:{type:"read"}}));}catch{/* Keep the original error. */}}
  finally{pending=false;render();}
}
function render():void{
  if(!root?.isConnected)return;
  const enabled=root.querySelector<HTMLInputElement>("#history-enabled")!;
  enabled.checked=view?.enabled??true;enabled.disabled=pending||!view||!native;
  const entries=view?.entries??[];
  root.querySelector<HTMLElement>("#history-summary")!.textContent=`${entries.length} записей · только на этом компьютере`;
  root.querySelector<HTMLElement>("#history-message")!.textContent=message||view?.error||"";
  const exportButton=root.querySelector<HTMLButtonElement>("#history-export")!;exportButton.disabled=pending||!entries.length||!native;
  const clear=root.querySelector<HTMLButtonElement>("#history-clear")!;clear.disabled=pending||!native||(!entries.length&&!view?.error);clear.textContent=clearArmed?"Удалить всю историю":"Очистить";
  const list=root.querySelector<HTMLElement>("#history-list")!;list.replaceChildren();
  if(!view){list.textContent=native?"Загружаю историю…":"История доступна в приложении Windows.";return;}
  const matches=filterHistory(entries,query);
  if(!matches.length){list.textContent=query?"Ничего не найдено.":"Переводы появятся здесь после первого успешного запроса.";return;}
  const fragment=document.createDocumentFragment();
  for(const entry of matches.slice(0,limit)){
    const card=document.createElement("article");card.className="history-card";card.dataset.historyId=String(entry.id);
    const header=document.createElement("div");header.className="history-meta";
    const date=new Date(entry.createdAtMs).toLocaleString("ru-RU",{dateStyle:"short",timeStyle:"short"});
    header.textContent=`${MODE_NAMES[entry.mode]} · ${directionLabel(entry.direction)} · ${date} · ${(entry.elapsedMs/1000).toFixed(1)} с`;
    const source=document.createElement("pre");source.className="history-source";source.textContent=entry.source;
    const translation=document.createElement("pre");translation.className="history-translation";translation.textContent=entry.translation;
    const controls=document.createElement("div");controls.className="history-actions";
    for(const [label,text,part]of [["Копировать оригинал",entry.source,"source"],["Копировать перевод",entry.translation,"translation"]]){
      const copy=document.createElement("button");copy.className="secondary-button";copy.textContent=label;copy.dataset.historyCopy=part;
      copy.addEventListener("click",()=>void copyText(text).then(()=>{message="Скопировано";render();}).catch(error=>{message=String(error);render();}));controls.append(copy);
    }
    const remove=document.createElement("button");remove.className="text-button";remove.textContent="Удалить";remove.dataset.historyRemove=String(entry.id);remove.disabled=pending;
    remove.addEventListener("click",()=>void action({type:"remove",id:entry.id}));controls.append(remove);
    card.append(header,source,translation,controls);fragment.append(card);
  }
  list.append(fragment);
  if(matches.length>limit){const more=document.createElement("button");more.className="secondary-button";more.textContent="Показать ещё";more.addEventListener("click",()=>{limit+=40;render();});list.append(more);}
}
export function mountHistory(element:HTMLElement):void{
  root=element;clearArmed=false;
  root.innerHTML=`<div class="history-toolbar"><label><input id="history-enabled" type="checkbox"/> Сохранять историю</label><button id="history-export" class="secondary-button" title="Выгрузить всю историю в JSON в папку Загрузки / Veylo AI">Экспорт JSON</button><button id="history-clear" class="text-button">Очистить</button></div><input id="history-search" type="search" maxlength="200" placeholder="Поиск по оригиналу и переводу" aria-label="Поиск в истории"/><p id="history-summary" class="muted"></p><p class="muted">До 500 записей и 8 МБ. Снимки не сохраняются. Выгрузка содержит всю историю.</p><p id="history-message" role="status"></p><div id="history-list"></div>`;
  const search=root.querySelector<HTMLInputElement>("#history-search")!;search.value=query;
  search.addEventListener("input",()=>{query=search.value;limit=40;clearTimeout(searchTimer);searchTimer=setTimeout(render,100);});
  root.querySelector<HTMLInputElement>("#history-enabled")!.addEventListener("change",event=>void action({type:"setEnabled",enabled:(event.currentTarget as HTMLInputElement).checked}));
  root.querySelector("#history-export")!.addEventListener("click",()=>void action({type:"export"}));
  root.querySelector("#history-clear")!.addEventListener("click",()=>{if(clearArmed){clearArmed=false;void action({type:"clear"});}else{clearArmed=true;render();}});
  render();if(native)void invoke<HistoryReply>("history_action",{action:{type:"read"}}).then(accept).catch(error=>{message=String(error);render();});
}
export async function observeHistory(notify:(message:string)=>void):Promise<void>{
  if(!native)return;
  await listen<string>("history-warning",event=>notify(event.payload));
  await listen("history-changed",()=>{if(root?.isConnected)void invoke<HistoryReply>("history_action",{action:{type:"read"}}).then(accept).catch(error=>{message=String(error);render();});});
}
