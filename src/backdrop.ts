import { dismissOverlay, reportBackdropStyles, observeCapture, finishScreenCapture, cancelScreenCapture, getFrozenFrame, type CaptureStatus } from "./bridge";
import { screenRegion, translationPlacement, textBlockPlacement } from "./screen-region";

document.querySelector("#app")!.innerHTML = `<img id="frozen-frame" alt="Зафиксированный снимок экрана" hidden draggable="false"/><button class="return-to-game" aria-label="Вернуться в игру"><span class="overlay-brand"><i class="overlay-dot" aria-hidden="true"></i>VEYLO AI</span><span class="hud-divider" aria-hidden="true"></span><span class="return-hint"><kbd>Esc</kbd>В игру</span></button><div id="backdrop-error" role="alert" hidden></div><div id="capture-surface" hidden><div class="capture-instruction">Выдели область <span>Esc — в игру · Только выделенная картинка отправится в Codex</span></div><div id="capture-selection" hidden></div></div><section id="inplace-result" hidden aria-label="Перевод снимка"><div id="inplace-text" aria-live="polite"></div></section><div id="capture-exit" hidden>Кадр зафиксирован <span>Esc — в игру</span></div>`;
const frame = document.querySelector<HTMLImageElement>("#frozen-frame")!;
const surface = document.querySelector<HTMLElement>("#capture-surface")!;
const selection = document.querySelector<HTMLElement>("#capture-selection")!;
const result = document.querySelector<HTMLElement>("#inplace-result")!;
const text = document.querySelector<HTMLElement>("#inplace-text")!;
const error = document.querySelector<HTMLElement>("#backdrop-error")!;
const progress = document.createElement("div");
progress.id = "capture-progress"; progress.hidden = true;
progress.setAttribute("role", "status"); progress.textContent = "Перевожу…";
document.querySelector("#app")!.append(progress);
const blockLayer = document.createElement("div"); blockLayer.id = "translation-blocks"; blockLayer.hidden = true;
document.querySelector("#app")!.append(blockLayer);
const originalButton = document.createElement("button"); originalButton.id = "toggle-original"; originalButton.textContent = "Оригинал"; originalButton.hidden = true;
document.querySelector("#capture-exit")!.prepend(originalButton);
let showOriginal = false;
originalButton.addEventListener("click", event => { event.stopPropagation(); showOriginal = !showOriginal; render(); });
let state: CaptureStatus = { phase: "idle", error: null };
let closing = false, finishing = false, ignoreNextClick = false;
let start: { x: number; y: number } | null = null;
let frameGeneration: number | undefined;
let requestedGeneration: number | undefined;
let renderedBlocksKey = "";
let sampledFrame: { generation: number | undefined; pixels: ImageData } | undefined;

const transparentBase = [document.documentElement, document.body, document.querySelector("#app")!].every(element => ["transparent", "rgba(0, 0, 0, 0)"].includes(getComputedStyle(element).backgroundColor));
void reportBackdropStyles({ transparentBase, hudStyled: getComputedStyle(document.querySelector(".return-to-game")!).position === "fixed", gradients: getComputedStyle(document.body, "::before").backgroundImage.includes("radial-gradient") }).catch(() => {});

function layoutResult(): void {
  if (state.phase === "error") {
    const width=Math.min(560,Math.max(0,innerWidth-32));
    Object.assign(result.style,{left:`${(innerWidth-width)/2}px`,top:`${Math.max(16,innerHeight*.4)}px`,width:`${width}px`,height:"auto",maxHeight:"40vh"});
    text.style.fontSize="16px";
    return;
  }
  result.style.maxHeight="";
  if (!state.region) return;
  const area = translationPlacement(state.region, innerWidth, innerHeight);
  if (!area) return;
  Object.assign(result.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px` });
  if (state.region.left === 0 && state.region.top === 0 && state.region.right === 1 && state.region.bottom === 1) {
    text.style.fontSize = "18px";
    return; // Full-screen text scrolls without shrinking to tiny type.
  }
  // Shrink moderately to fit, then allow scrolling instead of unreadable text.
  let size = Math.min(22, Math.max(14, area.height / 12));
  text.style.fontSize = `${size}px`;
  while (size > 12 && text.scrollHeight > text.clientHeight + 1) { size -= 1; text.style.fontSize = `${size}px`; }
}
function renderBlocks(): void {
  if (state.phase !== "result" || !state.blocks?.length) {
    if (blockLayer.childElementCount) blockLayer.replaceChildren();
    renderedBlocksKey="";
    if (state.phase === "idle") sampledFrame=undefined;
    return;
  }
  if (blockLayer.hidden || !frame.complete || !frame.naturalWidth) return;
  const key=JSON.stringify([state.generation,frameGeneration,innerWidth,innerHeight,state.blocks]);
  if (key === renderedBlocksKey) return;
  if (!sampledFrame || sampledFrame.generation !== frameGeneration) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1280, frame.naturalWidth); canvas.height = Math.max(1, Math.round(canvas.width * frame.naturalHeight / frame.naturalWidth));
    const draw = canvas.getContext("2d", { willReadFrequently: true });
    try {
      draw?.drawImage(frame, 0, 0, canvas.width, canvas.height);
      if (draw) sampledFrame={generation:frameGeneration,pixels:draw.getImageData(0,0,canvas.width,canvas.height)};
    } catch { /* Neutral fallback if frame is not decoded yet. */ }
  }
  const fragment=document.createDocumentFragment();
  const fitting: {element:HTMLDivElement;low:number;high:number;best:number;mid:number}[]=[];
  for (const block of state.blocks ?? []) {
    const area = textBlockPlacement(block.region, innerWidth, innerHeight); if (!area) continue;
    const element = document.createElement("div"); element.className = "translated-block";
    element.textContent = block.translation; element.title = block.source; element.setAttribute("aria-label", block.translation);
    const tones: number[] = [];
    try {
      for (const [x, y] of [[block.region.left, block.region.top], [block.region.right, block.region.top], [block.region.left, block.region.bottom], [block.region.right, block.region.bottom]]) {
        const pixels=sampledFrame?.pixels;
        if (pixels) {
          const offset=(Math.min(pixels.height-1,Math.max(0,Math.round(y*pixels.height)))*pixels.width+Math.min(pixels.width-1,Math.max(0,Math.round(x*pixels.width))))*4;
          tones.push(Math.round(.2126*pixels.data[offset]+.7152*pixels.data[offset+1]+.0722*pixels.data[offset+2]));
        }
      }
    } catch { /* A failed sample must not prevent translation display. */ }
    tones.sort((a, b) => a - b); const tone = tones.length ? tones[Math.floor(tones.length / 2)] : 32;
    Object.assign(element.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px`, background: `rgb(${tone} ${tone} ${tone})`, color: tone > 150 ? "#151515" : "#f5f5f5" });
    fragment.append(element);
    const high=Math.floor(Math.min(44, Math.max(12, (area.height - 4) / (Math.max(1, block.source.split("\n").length) * 1.25))));
    fitting.push({element,low:12,high,best:12,mid:12});
  }
  blockLayer.replaceChildren(fragment);
  // Batch writes, then reads: at most six layout passes for every block together.
  while (fitting.some(item=>item.low<=item.high)) {
    const active=fitting.filter(item=>item.low<=item.high);
    for (const item of active) {item.mid=Math.floor((item.low+item.high)/2);item.element.style.fontSize=`${item.mid}px`;}
    for (const item of active) {
      const fits=item.element.scrollHeight<=item.element.clientHeight+1 && item.element.scrollWidth<=item.element.clientWidth+1;
      if (fits) {item.best=item.mid;item.low=item.mid+1;} else item.high=item.mid-1;
    }
  }
  for (const item of fitting) item.element.style.fontSize=`${item.best}px`;
  renderedBlocksKey=key;
}
function render(): void {
  const scene = state.phase !== "idle";
  const selecting = state.phase === "selecting";
  document.body.dataset.capture = String(selecting);
  document.body.dataset.scene = String(scene);
  document.body.dataset.frozen = String(scene && frameGeneration === state.generation && frame.complete && frame.naturalWidth > 0);
  frame.hidden = !scene || frameGeneration !== state.generation;
  surface.hidden = !selecting;
  document.querySelector<HTMLElement>("#capture-exit")!.hidden = !scene || selecting;
  const hasBlocks = state.phase === "result" && Boolean(state.blocks?.length);
  progress.hidden = state.phase !== "translating";
  originalButton.hidden = !hasBlocks;
  originalButton.textContent = showOriginal ? "Перевод" : "Оригинал";
  originalButton.setAttribute("aria-pressed", String(showOriginal));
  blockLayer.hidden = !hasBlocks || showOriginal || frameGeneration !== state.generation;
  result.hidden = hasBlocks || !["result", "error"].includes(state.phase) || !state.region;
  if (!selecting) { start = null; selection.hidden = true; }
  text.textContent = state.phase === "translating" ? "Читаю и перевожу…" : state.error ?? state.translated ?? "";
  const neutralNotice=state.phase === "error" && (state.error?.startsWith("Текст уже на русском") || state.error?.startsWith("В выбранном месте нет текста"));
  result.dataset.phase = neutralNotice ? "notice" : state.phase;
  if (!result.hidden) layoutResult();
  renderBlocks();
  if (state.phase === "error" && !state.region) { error.textContent = state.error ?? "Не удалось перевести кадр. Нажми Esc."; error.hidden = false; }
}
frame.addEventListener("load", render);
frame.addEventListener("error", () => { if (state.phase === "idle" || frameGeneration !== state.generation) return; error.textContent = "Кадр не загрузился. Нажми Esc и повтори."; error.hidden = false; });
void observeCapture(next => {
  if ((next.generation ?? 0) < (state.generation ?? 0)) return;
  if (next.generation !== state.generation) showOriginal = false;
  state = next;
  if (next.phase !== "selecting") finishing = false;
  if (next.phase === "idle") {
    requestedGeneration = undefined; frameGeneration = undefined;
    frame.removeAttribute("src"); error.hidden = true; finishing = false; ignoreNextClick = false;
  } else if (["selecting", "translating", "result", "error"].includes(next.phase) && requestedGeneration !== next.generation) {
    const generation = next.generation; requestedGeneration = generation; error.hidden = true;
    void getFrozenFrame().then(snapshot => {
      if (!snapshot || snapshot.generation !== generation || state.generation !== generation || state.phase === "idle") return;
      frameGeneration = generation; frame.src = snapshot.image; render();
    }).catch(() => { if (state.generation !== generation || state.phase === "idle") return; error.textContent = "Не удалось загрузить кадр. Нажми Esc."; error.hidden = false; });
  }
  render();
}).catch(() => { error.textContent = "Не удалось открыть режим перевода. Нажми Esc."; error.hidden = false; });

surface.addEventListener("pointerdown", event => {
  if (state.phase !== "selecting" || finishing || event.button !== 0 || !frame.complete || frame.naturalWidth === 0 || frameGeneration !== state.generation) return;
  start = { x: event.clientX, y: event.clientY }; surface.setPointerCapture(event.pointerId); selection.hidden = false;
  Object.assign(selection.style, { left: `${start.x}px`, top: `${start.y}px`, width: "0px", height: "0px" });
});
surface.addEventListener("pointermove", event => {
  if (!start || finishing) return;
  Object.assign(selection.style, { left: `${Math.min(start.x, event.clientX)}px`, top: `${Math.min(start.y, event.clientY)}px`, width: `${Math.abs(event.clientX - start.x)}px`, height: `${Math.abs(event.clientY - start.y)}px` });
});
surface.addEventListener("pointerup", event => {
  if (!start || finishing || event.button !== 0) return;
  const region = screenRegion(start, { x: event.clientX, y: event.clientY }, innerWidth, innerHeight); start = null;
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  if (!region) { selection.hidden = true; return; }
  finishing = true; ignoreNextClick = true;
  const generation = state.generation ?? 0;
  void finishScreenCapture(region, generation).catch(reason => { if (state.generation !== generation) return; finishing = false; error.textContent = String(reason); error.hidden = false; });
});
surface.addEventListener("pointercancel", () => { start = null; selection.hidden = true; });
async function dismiss(): Promise<void> {
  if (closing) return; closing = true;
  try { if (state.phase !== "idle") await cancelScreenCapture(); else await dismissOverlay(); }
  catch (reason) { error.textContent = String(reason); error.hidden = false; }
  finally { closing = false; }
}
document.addEventListener("contextmenu", event => { if (state.phase !== "idle") { event.preventDefault(); void dismiss(); } });
document.addEventListener("click", event => {
  if (ignoreNextClick) { ignoreNextClick = false; return; }
  if (state.phase === "selecting" || finishing || (event.target instanceof Element && event.target.closest("#inplace-result, .translated-block"))) return;
  void dismiss();
});
document.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); void dismiss(); } });
let resizeFrame=0;
window.addEventListener("resize", () => {
  if (resizeFrame) return;
  resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;layoutResult();renderBlocks();});
});
