import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {native} from "./bridge";
import {HOTKEY_ACTIONS,recordedShortcut,type HotkeyAction} from "./hotkeys";
interface View {ready:boolean;revision:number;bindings:{action:HotkeyAction;key:string;registered:boolean;error:string|null}[];error:string|null}
let root:HTMLElement|null=null,view:View|null=null,recording:HotkeyAction|null=null,pending=false,message="",timer:ReturnType<typeof setTimeout>|undefined,initialized=false,loading=false;
function render():void{
  if(!root?.isConnected)return;
  root.replaceChildren();
  const title=document.createElement("h3");title.textContent="Горячие клавиши";root.append(title);
  for(const item of HOTKEY_ACTIONS){
    const binding=view?.bindings.find(binding=>binding.action===item.action);
    const row=document.createElement("div");row.className="hotkey-setting";
    const label=document.createElement("span");label.textContent=item.label;
    const button=document.createElement("button");button.className="secondary-button hotkey-bind";button.dataset.bindAction=item.action;
    button.textContent=recording===item.action?"Нажми сочетание…":binding?.key??item.defaultKey;
    button.setAttribute("aria-label",`Назначить: ${item.label}`);button.setAttribute("aria-pressed",String(recording===item.action));
    button.disabled=!native || pending || !view?.ready || (recording!==null && recording!==item.action);
    button.addEventListener("click",()=>void(recording===item.action?cancel():begin(item.action)));
    const reset=document.createElement("button");reset.className="secondary-button hotkey-reset";reset.dataset.resetAction=item.action;reset.textContent="Сброс";reset.title=`Вернуть ${item.defaultKey}`;
    reset.disabled=!native || pending || !view?.ready || recording!==null;
    reset.addEventListener("click",()=>void submit(item.action,item.defaultKey));
    row.append(label,button,reset);root.append(row);
    if(view?.ready && (binding?.error || binding && !binding.registered)){const error=document.createElement("p");error.className="open-error";error.textContent=binding.error??"Клавиша не зарегистрирована. Назначь другую.";root.append(error);}
  }
  const info=document.createElement("p");info.id="hotkey-message";info.className="muted";info.setAttribute("role","status");
  info.textContent=message || view?.error || (!view?.ready?"Загружаю горячие клавиши…":recording?"Esc — отмена. Нажми нужную комбинацию.":"Нажми на сочетание, чтобы изменить его. Сохраняется автоматически.");root.append(info);
}
async function cancel():Promise<void>{
  recording=null;clearTimeout(timer);render();
  if(native)await invoke("set_hotkey_recording",{recording:false}).catch(()=>{});
}
async function begin(action:HotkeyAction):Promise<void>{
  pending=true;message="";render();
  try{await invoke("set_hotkey_recording",{recording:true});recording=action;timer=setTimeout(()=>void cancel(),30000);}
  catch(error){message=String(error);}
  finally{pending=false;render();}
}
async function submit(action:HotkeyAction,key:string):Promise<void>{
  if(pending)return;
  pending=true;recording=null;clearTimeout(timer);message="Сохраняю…";render();
  try{
    await invoke("set_hotkey_recording",{recording:false});
    accept(await invoke<View>("set_hotkey",{action,key}));message="Сохранено";
  }catch(error){message=String(error);}
  finally{pending=false;render();}
}
function accept(next:View):void{
  if(!view || next.revision>=view.revision)view=next;
  render();
}
async function refresh():Promise<void>{
  if(loading)return;loading=true;
  try{accept(await invoke<View>("get_hotkeys"));}
  catch(error){message=String(error);}
  finally{loading=false;render();}
}
export function mountHotkeys(element:HTMLElement):void{
  root=element;render();
  if(initialized){if(native)void refresh();return;}
  initialized=true;
  // Subscribe before reading: initialization may finish while the first read is in flight.
  if(native)void listen<View>("hotkeys-changed",event=>accept(event.payload))
    .catch(error=>{message=String(error);render();}).then(()=>refresh());
  document.addEventListener("keydown",event=>{
    if(!recording || pending)return;
    if(!root?.isConnected){void cancel();return;}
    event.preventDefault();event.stopImmediatePropagation();
    if(event.code==="Escape"){void cancel();return;}
    if(event.repeat || event.isComposing)return;
    try{const key=recordedShortcut(event);if(key)void submit(recording,key);}catch(error){message=(error as Error).message;render();}
  },true);
  window.addEventListener("blur",()=>{if(recording)void cancel();});
  if(native)void listen<string>("hotkey-recorded",event=>{if(recording && !pending && root?.isConnected)void submit(recording,event.payload);}).catch(error=>{message=String(error);render();});
}
