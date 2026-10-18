import {test} from "node:test";
import assert from "node:assert/strict";
import {recordedShortcut,HOTKEY_ACTIONS} from "../src/hotkeys.ts";
const key=(code:string,ctrlKey=false,altKey=false,shiftKey=false)=>({code,ctrlKey,altKey,shiftKey,metaKey:false});
test("records physical keys consistently across typing languages",()=>{
  assert.equal(recordedShortcut(key("KeyQ",true,false,true)),"Ctrl + Shift + Q");
  assert.equal(recordedShortcut(key("Digit1",false,true)),"Alt + 1");
  assert.equal(recordedShortcut(key("F8")),"F8");assert.equal(recordedShortcut(key("Space",true)),"Ctrl + Space");
  assert.equal(recordedShortcut(key("ControlLeft",true)),null);
  for(const event of [key("KeyA"),key("KeyF"),key("Escape"),key("F25"),key("KeyA",false,false,true),{...key("KeyQ",true),metaKey:true}])assert.throws(()=>recordedShortcut(event));
  assert.equal(new Set(HOTKEY_ACTIONS.map(action=>action.defaultKey)).size,4);
});
