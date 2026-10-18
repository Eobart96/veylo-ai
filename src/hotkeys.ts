export type HotkeyAction="overlay"|"screen"|"area"|"cursor";
export const HOTKEY_ACTIONS: {action:HotkeyAction;label:string;defaultKey:string}[]=[
  {action:"overlay",label:"Открыть / скрыть оверлей",defaultKey:"Ctrl + Shift + Space"},
  {action:"screen",label:"Весь экран",defaultKey:"Alt + Q"},
  {action:"area",label:"Выделить область",defaultKey:"Alt + E"},
  {action:"cursor",label:"Текст под мышью",defaultKey:"Alt + W"},
];
export function recordedShortcut(event:Pick<KeyboardEvent,"code"|"ctrlKey"|"altKey"|"shiftKey"|"metaKey">):string|null {
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code)) return null;
  if(event.metaKey) throw new Error("Используй Ctrl, Alt или Shift без клавиши Windows.");
  const key=/^Key[A-Z]$/.test(event.code)?event.code.slice(3):/^Digit[0-9]$/.test(event.code)?event.code.slice(5):event.code==="Space"?"Space":/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)?event.code:null;
  if(!key) throw new Error("Используй букву, цифру, пробел или F1–F24.");
  if(!event.ctrlKey && !event.altKey && !/^F\d+$/.test(key))throw new Error("Добавь Ctrl или Alt, либо выбери F1–F24.");
  return [...(event.ctrlKey?["Ctrl"]:[]),...(event.altKey?["Alt"]:[]),...(event.shiftKey?["Shift"]:[]),key].join(" + ");
}
