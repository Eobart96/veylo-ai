export type HistoryMode="text"|"screen"|"area"|"cursor";
export interface HistoryEntry{id:number;createdAtMs:number;mode:HistoryMode;direction:string;source:string;translation:string;elapsedMs:number}
export interface HistorySnapshot{revision:number;enabled:boolean;entries:HistoryEntry[];error:string|null}
export interface HistoryReply{snapshot:HistorySnapshot;exportPath:string|null}
export const MODE_NAMES:Record<HistoryMode,string>={text:"Текст",screen:"Весь экран",area:"Область",cursor:"Под мышью"};
export function filterHistory(entries:HistoryEntry[],query:string):HistoryEntry[]{
  const needle=query.trim().toLocaleLowerCase();
  return entries.filter(entry=>!needle || entry.source.toLocaleLowerCase().includes(needle)||entry.translation.toLocaleLowerCase().includes(needle)).slice().reverse();
}
export function directionLabel(direction:string):string{
  const names:Record<string,string>={auto:"Авто",ru:"Русский",sk:"Словацкий",en:"Английский"};
  return direction.split("-").map(code=>names[code]??code).join(" → ");
}
