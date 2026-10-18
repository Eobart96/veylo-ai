import {test} from "node:test";
import assert from "node:assert/strict";
import {filterHistory,directionLabel,type HistoryEntry} from "../src/history.ts";
const entries:HistoryEntry[]=[{id:1,createdAtMs:100,mode:"text",direction:"auto-ru",source:"Ahoj",translation:"Привет",elapsedMs:20},{id:2,createdAtMs:200,mode:"cursor",direction:"auto-ru",source:"IRON",translation:"Железо",elapsedMs:30}];
test("history search finds either text, newest first, without mutating stored entries",()=>{
  assert.deepEqual(filterHistory(entries,"" ).map(entry=>entry.id),[2,1]);
  assert.deepEqual(filterHistory(entries,"  жЕлЕЗ  ").map(entry=>entry.id),[2]);
  assert.equal(filterHistory(entries,"ahoj")[0].id,1);assert.equal(filterHistory(entries,"missing").length,0);assert.equal(entries[0].id,1);
  assert.equal(directionLabel("auto-ru"),"Авто → Русский");
});
