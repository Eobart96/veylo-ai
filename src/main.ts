import {mountHistory,observeHistory} from "./history-view";
import {mountHotkeys} from "./hotkey-settings";
import "./style.css";
import { native, getStatus, observeStatus, copyText, translateText, setOverlay, hideOverlay, dismissOverlay, observeOverlay, setPinned, dragPanel, resizePanel, setPanelSize, resetPanelPosition, showMain, observeTranslations, currentWindowLabel, reportFrontendReady, openOverlayCentered, getOverlayView, type OverlayView, type TranslationSnapshot, type AppStatus, type Translation } from "./bridge";
import { DRAFT_KEY, restoreDrafts, EMPTY_DRAFTS, LANGUAGES, DIRECTIONS, languagePair, selectLanguage, draftKey, parseSection, mergeDraftChange, type Drafts, type Section, type Direction } from "./state";
import { windowRole, visibleSections } from "./window-role";
import { overlayStatus } from "./overlay-status";
import type { ResizeDirection } from "./bridge";
import { startScreenCapture, startCursorLine, observeCapture, observeScreenText } from "./bridge";

const app = document.querySelector<HTMLDivElement>("#app")!;
const role = windowRole(location.search, currentWindowLabel());
let section: Section = role === "overlay" ? "translate" : "overlay";
let direction: Direction = "auto-ru";
let busy = false;
let captureBusy = false;
const overlayMode = role === "overlay";
document.body.dataset.mode = overlayMode ? "overlay" : "window";
let overlayVisible = false;
let pinned = false;
let latestTranslation: TranslationSnapshot | null = null;
let overlaySettings: OverlayView | null = null;
let lastSaveError: string | null = null;
let openingOverlay = false;
let overlayOpenError = "";
let readinessTimer: ReturnType<typeof setTimeout> | undefined;
const translations: Partial<Record<Direction, Translation>> = {};
const translationErrors: Partial<Record<Direction, string>> = {};
let status: AppStatus | null = null;
let statusError = "";
let drafts = { ...EMPTY_DRAFTS };
let storageAvailable = true;
try { drafts = restoreDrafts(localStorage.getItem(DRAFT_KEY)); } catch { storageAvailable = false; }

const paths: Record<string, string> = {
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  translate: '<path d="M4 5h12M10 3v2c0 6-3 10-7 12m2-9c1 4 4 7 8 9m1 4 4-10 4 10m-6-3h4"/>',
  assistant: '<path d="M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="m12 7 1.2 3.8L17 12l-3.8 1.2L12 17l-1.2-3.8L7 12l3.8-1.2Z"/>',
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  guide: '<path d="M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3Z"/><path d="M12 6v15M6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
  pin: '<path d="m15 3 6 6-3 1-4 4 1 3-2 2-8-8 2-2 3 1 4-4ZM3 21l6-6"/>',
  capture: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  eye: '<path d="M3 7h18M6 12h12m-9 5h6"/>',
};
function icon(name: string): string { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.arrow}</svg>`; }
const names = { translate: "Перевод", overlay: "Настройки", history: "История", assistant: "Помощник", browser: "Браузер", guide: "О проекте" };

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand" title="Veylo AI"><img src="/mark.svg" alt="Veylo AI"/></div>
      <nav aria-label="Разделы">${visibleSections(role).map(key => `<button class="nav-item ${key === section ? "active" : ""}" data-section="${key}">${icon(key === "overlay" ? "capture" : key)}<span>${names[key]}</span></button>`).join("")}</nav>
      <div class="sidebar-bottom"><span class="live-dot"></span><span>v0.1</span></div>
    </aside>
    <div class="workspace">
      <header class="topbar" title="Потяни, чтобы переместить"><div class="game-label"><span class="game-cube">▧</span><span>${overlayMode ? "Veylo AI · переводчик" : "Veylo AI"}</span><span class="session-tag">${overlayMode ? "" : "AI-помощник"}</span></div><div class="window-actions"><button id="pin-panel" class="icon-button" ${overlayMode ? "" : "hidden"} aria-label="Оставлять поверх окон после выхода" title="Оставлять поверх окон после выхода" aria-pressed="false">${icon("pin")}</button><button id="overlay-toggle" class="secondary-button">${overlayMode ? "Программа" : "Открыть оверлей"}</button><button id="overlay-close" class="icon-button" ${overlayMode ? "" : "hidden"} aria-label="Скрыть переводчик" title="Скрыть переводчик">×</button></div></header>
      <main id="content"></main>
      <footer><span id="runtime-label"></span><span id="storage-label">Черновики на устройстве</span></footer>
    </div>
  </div>
  ${overlayMode ? (["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"] as const).map(edge => `<div class="resize-edge" data-resize="${edge}" aria-hidden="true" title="Потяни, чтобы изменить размер">${edge === "SouthEast" ? "◢" : ""}</div>`).join("") : ""}
  <div id="toast" role="status" aria-live="polite" hidden></div>`;

const content = document.querySelector<HTMLElement>("#content")!;
const header = document.querySelector<HTMLElement>(".topbar")!;
header.addEventListener("pointerdown", event => {
  if (event.button !== 0 || (event.target as Element).closest("button")) return;
  void dragPanel().catch(error => notify(String(error)));
});
document.querySelectorAll<HTMLElement>("[data-resize]").forEach(edge => edge.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  event.preventDefault();
  void resizePanel(edge.dataset.resize as ResizeDirection).catch(error => notify(String(error)));
}));
let toastTimeout: ReturnType<typeof setTimeout>;
function notify(message: string): void {
  const toast = document.querySelector<HTMLDivElement>("#toast")!;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 5500);
}
function save(key?: keyof Drafts): void {
  try {
    if (key) drafts = mergeDraftChange(restoreDrafts(localStorage.getItem(DRAFT_KEY)), drafts, key);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); storageAvailable = true;
  }
  catch { storageAvailable = false; }
  document.querySelector("#storage-label")!.textContent = storageAvailable ? "Черновики на устройстве" : "Черновики только до закрытия";
}
function heading(eyebrow: string, title: string, description: string): string {
  return `<div class="page-heading"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>`;
}
function render(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-section]").forEach(button => {
    const active = button.dataset.section === section;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (section === "translate") renderTranslate();
  if (section === "history") {
    content.innerHTML=heading("HISTORY","История переводов","")+'<div id="history-root"></div>';
    mountHistory(document.querySelector<HTMLElement>("#history-root")!);
  }
  if (section === "overlay") renderOverlayControls();
  if (section === "assistant") renderAssistant();
  if (section === "browser") renderBrowser();
  if (section === "guide") renderGuide();
}
function renderOverlayControls(): void {
  content.innerHTML = `${heading("OVERLAY", "Настройки переводчика", "")}
    <div class="overlay-settings"><div class="overlay-status"><span class="live-dot"></span><strong id="overlay-open-status" role="status"></strong></div>
    <p class="muted">Небольшое отдельное окно. Настройки сохраняются автоматически.</p>
    <div class="overlay-controls"><button id="open-overlay" class="primary-button" ${native && !openingOverlay ? "" : "disabled"}>${openingOverlay ? "Открываем…" : "Открыть оверлей"} ${icon("capture")}</button><button id="hide-panel" class="secondary-button" ${overlayVisible ? "" : "disabled"}>Скрыть</button><button id="find-overlay" class="secondary-button" ${native && !openingOverlay ? "" : "disabled"}>Открыть в центре</button></div>
    <p id="overlay-open-error" class="open-error" role="alert" hidden></p>


    <div id="hotkey-settings"></div>
    <div class="setting-row"><span>После выхода из оверлея</span>${displayModeSwitch("settings")}</div>
    <div class="setting-row"><label for="settings-size">Размер окна</label><select id="settings-size" ${native && overlaySettings ? "" : "disabled"}><option value="custom">Текущий · ${Math.round(overlaySettings?.width ?? 360)} × ${Math.round(overlaySettings?.height ?? 280)}</option><option value="360,280">Маленький · 360 × 280</option><option value="420,360">Средний · 420 × 360</option><option value="560,400">Побольше · 560 × 400</option></select></div>
    <div class="setting-row"><span>Положение на экране</span><button id="center-panel" class="secondary-button" ${native ? "" : "disabled"}>В центр</button></div>
    <div class="overlay-tips"><span>Горячие клавиши работают поверх других окон, пока Veylo AI запущена</span><span>Клавиша оверлея открывает окно с затемнением</span><span>Закрепи окно булавкой: после Esc оно останется поверх окон</span><span>Перемещение — за верхнюю полоску · Размер — за край или угол</span></div><p id="settings-save-status" class="muted" role="status"></p></div>`;
  mountHotkeys(document.querySelector<HTMLElement>("#hotkey-settings")!);
  document.querySelector("#overlay-open-status")!.textContent = overlayStatus(overlaySettings, openingOverlay, overlayOpenError);
  const openError = document.querySelector<HTMLElement>("#overlay-open-error")!;
  openError.textContent = overlayOpenError || overlaySettings?.openError || "";
  openError.hidden = !openError.textContent;
  document.querySelector("#open-overlay")!.addEventListener("click", () => void openTranslator(false));
  document.querySelector("#find-overlay")!.addEventListener("click", () => void openTranslator(true));
  document.querySelector("#hide-panel")!.addEventListener("click", () => { overlayOpenError = ""; void hideOverlay().catch(error => { overlayOpenError = String(error); renderOverlayControls(); }); });
  document.querySelector("#settings-save-status")!.textContent = overlaySettings?.saveError ?? "Положение, размер и булавка сохраняются после выхода.";
  wireDisplayMode();
  document.querySelector<HTMLSelectElement>("#settings-size")!.addEventListener("change", event => {
    const input = event.currentTarget as HTMLSelectElement;
    if (input.value === "custom") return;
    const [width, height] = input.value.split(",").map(Number); input.disabled = true;
    void setPanelSize(width, height).catch(error => { notify(String(error)); renderOverlayControls(); });
  });
  document.querySelector("#center-panel")!.addEventListener("click", () => void resetPanelPosition().catch(error => notify(String(error))));
}
function applyOverlayView(view: OverlayView): void {
  overlaySettings = view;
  overlayVisible = view.visible;
  pinned = view.pinned;
  if (!overlayMode) document.querySelector("#overlay-toggle")!.textContent = "Открыть оверлей";
  document.body.dataset.pinned = String(overlayMode && pinned);
  document.body.dataset.editing = String(overlayMode && view.editing);
  const pin = document.querySelector<HTMLButtonElement>("#pin-panel")!;
  pin.setAttribute("aria-pressed", String(pinned));
  pin.title = pin.ariaLabel = pinned ? "Открепить окно" : "Закрепить поверх окон";
  document.querySelectorAll<HTMLButtonElement>("[data-display-mode]").forEach(button => {
    button.setAttribute("aria-pressed", String((button.dataset.displayMode === "top") === pinned));
    button.disabled = !native;
  });
  if (view.saveError && view.saveError !== lastSaveError) notify(view.saveError);
  lastSaveError = view.saveError;
  if (view.visible && view.ready && !view.openError) { clearTimeout(readinessTimer); overlayOpenError = ""; }
  if (section === "overlay") renderOverlayControls();
}
async function openTranslator(centered: boolean): Promise<void> {
  if (openingOverlay) return;
  openingOverlay = true; overlayOpenError = ""; clearTimeout(readinessTimer);
  if (section === "overlay") renderOverlayControls();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const view = await Promise.race([
      centered ? openOverlayCentered() : setOverlay(true),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Veylo AI не ответила на открытие окна. Перезапусти программу и попробуй снова.")), 8000); }),
    ]);
    applyOverlayView(view);
    if (!view.ready) readinessTimer = setTimeout(() => {
      void getOverlayView().then(current => {
        if (current) applyOverlayView(current);
        if (current?.visible && !current.ready) {
          overlayOpenError = "Окно создано, но интерфейс переводчика не загрузился. Попробуй «Открыть в центре» или перезапусти Veylo AI.";
          if (section === "overlay") renderOverlayControls();
        }
      }).catch(error => { overlayOpenError = String(error); if (section === "overlay") renderOverlayControls(); });
    }, 8000);
  } catch (error) { overlayOpenError = String(error); }
  finally { clearTimeout(timeout); openingOverlay = false; if (section === "overlay") renderOverlayControls(); }
}
function displayModeSwitch(context: string): string {
  return `<div class="display-modes" role="group" aria-label="После выхода из оверлея" data-context="${context}"><button data-display-mode="overlay" aria-pressed="${!pinned}" ${native && overlaySettings ? "" : "disabled"}>Скрывать окно</button><button data-display-mode="top" aria-pressed="${pinned}" ${native && overlaySettings ? "" : "disabled"}>Оставлять поверх окон</button></div>`;
}
function wireDisplayMode(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-display-mode]").forEach(button => {
    button.addEventListener("click", async () => {
      document.querySelectorAll<HTMLButtonElement>("[data-display-mode]").forEach(item => { item.disabled = true; });
      try { await setPinned(button.dataset.displayMode === "top"); }
      catch (error) { notify(String(error)); }
      finally { document.querySelectorAll<HTMLButtonElement>("[data-display-mode]").forEach(item => { item.disabled = !native || !overlaySettings; }); }
    });
  });
}
function renderTranslate(): void {
  const [sourceLanguage, targetLanguage] = languagePair(direction);
  const sourceLabel = sourceLanguage === "auto" ? "Текст на любом языке" : LANGUAGES.find(language => language.code === sourceLanguage)!.textLabel;
  const languageOptions = (selected: string) => LANGUAGES.map(language => `<option value="${language.code}" ${language.code === selected ? "selected" : ""}>${language.name}</option>`).join("");
  content.innerHTML = `${heading("SK · RU · EN", "Перевод", "")}
    <div class="direction-switch language-pair" role="group" aria-label="Направление перевода"><select id="source-language" aria-label="С какого языка" ${busy || captureBusy ? "disabled" : ""}><option value="auto" ${sourceLanguage === "auto" ? "selected" : ""}>Авто</option>${languageOptions(sourceLanguage)}</select><button id="swap-languages" aria-label="Поменять языки местами" title="${sourceLanguage === "auto" ? "Для обмена выбери исходный язык" : "Поменять языки местами"}" ${busy || captureBusy || sourceLanguage === "auto" ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></svg></button><select id="target-language" aria-label="На какой язык" ${busy || captureBusy ? "disabled" : ""}>${languageOptions(targetLanguage)}</select></div>
    ${overlayMode ? `<div class="translation-tools"><button id="screen-translate" class="secondary-button" title="Выделенная область отправится в Codex для перевода на русский." ${native && !busy && !captureBusy ? "" : "disabled"}>${icon("capture")} ${captureBusy ? "Читаю…" : "Область"}</button><button id="screen-translate-full" class="secondary-button" title="Весь снимок монитора переводчика отправится в Codex для перевода на русский." ${native && !busy && !captureBusy ? "" : "disabled"}>${icon("capture")} Весь экран</button><button id="screen-translate-line" class="secondary-button" title="Наведи курсор на текст за 2 секунды. В Codex отправится полоса вокруг мыши на всю ширину монитора; для полного текста область может расшириться до экрана." ${native && !busy && !captureBusy ? "" : "disabled"}>Под мышью</button></div>` : ""}
    <div class="translation-card">
      <div class="source-pane"><div class="card-header"><span class="language-tag">${sourceLanguage === "auto" ? "АВТО" : sourceLanguage.toUpperCase()}</span><span>Текст</span><span class="card-hint">оригинал</span></div>
      <label class="sr-only" for="draft">${sourceLabel}</label>
      <textarea id="draft" maxlength="4000" placeholder="${sourceLabel}…" spellcheck="false" ${busy || captureBusy ? "readonly" : ""}></textarea>
      <div class="input-tools"><span class="muted">Текст отправляется в Codex по кнопке</span><span id="char-count" class="muted"></span></div></div>
      <div class="result-pane"><div class="card-header"><span class="language-tag secondary">${targetLanguage.toUpperCase()}</span><span>Перевод</span><span id="translation-time" class="card-hint"></span></div><div id="translation-output" class="empty-result" aria-live="polite"></div></div>
      <div class="card-actions"><button id="copy-result" class="secondary-button">${icon("copy")} Копировать</button><button id="translate" class="primary-button">${busy ? "Перевожу…" : "Перевести"} ${icon("arrow")}</button></div>
    </div>
    <div class="status-strip"><span class="notice-dot"></span> Codex · подписка ChatGPT <span class="stage-tag">SK · RU · EN</span></div>`;
  const input = document.querySelector<HTMLTextAreaElement>("#draft")!;
  wireDisplayMode();
  const captureScreen = async (fullScreen: boolean) => {
    if (captureBusy || busy) return;
    captureBusy = true; renderTranslate();
    try { await startScreenCapture(fullScreen); }
    catch (error) { captureBusy = false; renderTranslate(); notify(String(error)); }
  };
  document.querySelector("#screen-translate")?.addEventListener("click", () => void captureScreen(false));
  document.querySelector("#screen-translate-full")?.addEventListener("click", () => void captureScreen(true));
  document.querySelector("#screen-translate-line")?.addEventListener("click", async () => {
    if (busy || captureBusy) return;
    captureBusy = true; renderTranslate(); notify("Наведи мышь на текст: снимок через 2 секунды.");
    try { await startCursorLine(); } catch (error) { captureBusy = false; renderTranslate(); notify(String(error)); }
  });
  input.value = drafts[draftKey(direction)];
  const output = document.querySelector<HTMLDivElement>("#translation-output")!;
  const refreshResult = () => {
    const result = translations[direction];
    const error = translationErrors[direction];
    output.className = result && !busy && !error ? "translated-text" : "empty-result";
    output.textContent = captureBusy ? "Читаю и перевожу снимок…" : busy ? "Перевожу…" : error ?? result?.text ?? (native ? "Введи текст и нажми «Перевести»." : "Для перевода открой приложение Veylo AI.");
    document.querySelector<HTMLButtonElement>("#copy-result")!.disabled = busy || captureBusy || !result || Boolean(error);
    document.querySelector("#translation-time")!.textContent = result && !busy && !error ? `${(result.elapsedMs / 1000).toFixed(1)} с` : "";
  };
  const updateCount = () => {
    document.querySelector("#char-count")!.textContent = `${Array.from(input.value).length} / 4 000`;
    document.querySelector<HTMLButtonElement>("#translate")!.disabled = !native || busy || captureBusy || !input.value.trim();
  };
  refreshResult();
  updateCount();
  input.addEventListener("input", () => { drafts[draftKey(direction)] = input.value; delete translations[direction]; delete translationErrors[direction]; save(draftKey(direction)); updateCount(); refreshResult(); });
  const changeDirection = (next: Direction) => {
    if (busy || captureBusy) return;
    direction = next;
    renderTranslate();
  };
  document.querySelector<HTMLSelectElement>("#source-language")!.addEventListener("change", event => changeDirection(selectLanguage(direction, "source", (event.currentTarget as HTMLSelectElement).value)));
  document.querySelector<HTMLSelectElement>("#target-language")!.addEventListener("change", event => changeDirection(selectLanguage(direction, "target", (event.currentTarget as HTMLSelectElement).value)));
  document.querySelector("#swap-languages")!.addEventListener("click", () => changeDirection(selectLanguage(direction, "source", targetLanguage)));
  document.querySelector("#copy-result")!.addEventListener("click", () => {
    const result = translations[direction];
    if (result) void copyText(result.text).then(() => notify("Перевод скопирован.")).catch(error => notify(String(error)));
  });
  document.querySelector("#translate")!.addEventListener("click", () => void runTranslation());
}

async function runTranslation(): Promise<void> {
  const requestedDirection = direction;
  const text = drafts[draftKey(requestedDirection)];
  if (!native || busy || captureBusy || !text.trim()) return;
  busy = true; delete translationErrors[requestedDirection];
  if (section === "translate") renderTranslate();
  try {
    translations[requestedDirection] = await translateText(text, requestedDirection);
  } catch (error) {
    delete translations[requestedDirection];
    translationErrors[requestedDirection] = String(error);
  } finally {
    busy = latestTranslation?.busy ?? false;
    if (section === "translate") renderTranslate();
  }
}
function renderAssistant(): void {
  content.innerHTML = `${heading("AI", "Помощник", "")}
    <div class="assistant-card"><label class="field-label" for="game">Игра · версия · моды</label><input id="game" maxlength="12000" placeholder="Minecraft Java 1.21, без модов"/><label class="field-label" for="question">Вопрос</label><textarea id="question" maxlength="12000" placeholder="Что хочешь узнать?"></textarea><div class="suggestions"><button data-question="Как сделать щит в Minecraft?">Рецепт щита</button><button data-question="Чем отличается зачарование Удача от Шёлкового касания?">Зачарования</button></div><div class="card-actions"><span class="muted">ИИ не подключён</span><button class="primary-button" disabled>Спросить ${icon("arrow")}</button></div></div>`;
  const game = document.querySelector<HTMLInputElement>("#game")!;
  const question = document.querySelector<HTMLTextAreaElement>("#question")!;
  game.value = drafts.game; question.value = drafts.question;
  game.addEventListener("input", () => { drafts.game = game.value; save("game"); });
  question.addEventListener("input", () => { drafts.question = question.value; save("question"); });
  document.querySelectorAll<HTMLButtonElement>("[data-question]").forEach(button => button.addEventListener("click", () => { question.value = button.dataset.question ?? ""; drafts.question = question.value; save(); question.focus(); }));
}
function renderBrowser(): void {
  content.innerHTML = `${heading("WEB", "Браузер", "")}
    <div class="browser-preview"><div class="browser-chrome"><span>←</span><span>→</span><div>Адрес сайта · пока недоступно</div></div><div class="browser-empty">${icon("browser")}<h2>Браузер ещё не подключён</h2><span class="outline-tag">Вики · руководства · сервер</span></div></div>`;
}
function renderGuide(): void {
  content.innerHTML = `${heading("VEYLO AI", "AI-помощник", "Перевод экрана и текста. Помощь в работе с ПК — в планах.")}
    <div class="architecture"><div><span class="step-number">01</span><h2>Интерфейс</h2><p>Поля, кнопки и вкладки.<br>Здесь ты вводишь текст.</p><code>TypeScript + CSS</code></div><span class="flow-arrow">↔</span><div><span class="step-number">02</span><h2>Tauri</h2><p>Создаёт окно и передаёт<br>запросы между частями.</p><code>связующее звено</code></div><span class="flow-arrow">↔</span><div><span class="step-number">03</span><h2>Rust</h2><p>Работает с окном<br>и системой Windows.</p><code>src-tauri/src/</code></div></div>
    <div class="guide-card"><div class="guide-title"><h2>Попробуем связь с Rust</h2><span class="small-tag">без интернета</span></div><p>Кнопка вызывает <code>get_app_status</code>. Rust возвращает состояние программы, а интерфейс показывает результат ниже.</p><button id="check-rust" class="secondary-button">Проверить связь ${icon("arrow")}</button><pre id="rust-result" aria-live="polite">Проверка ещё не запускалась.</pre></div>
    <div class="guide-bottom"><p><strong>Что читать первым?</strong><br>В папке проекта открой <code>docs/START_HERE.md</code> — там разобраны файлы и первый Rust-код.</p><button id="clear-drafts" class="text-button">Очистить мои черновики</button></div>`;
  document.querySelector("#check-rust")!.addEventListener("click", async () => {
    const output = document.querySelector("#rust-result")!;
    try {
      const result = await getStatus();
      output.textContent = result ? `Связь с Rust работает.\nВерсия: ${result.version}\nСистема: ${result.platform}\nРежим: ${overlayMode ? "оверлей" : "обычное окно"}\nУспешный перевод через Codex: ${result.aiConnected ? "был в этом запуске" : "ещё не выполнялся"}` : "Это браузерный предпросмотр.\nОткрой Veylo AI через Start-Veylo.cmd для настоящего перевода.";
    } catch (error) { output.textContent = `Связь с Rust не удалась: ${String(error)}`; }
  });
  document.querySelector("#clear-drafts")!.addEventListener("click", () => {
    if (busy || captureBusy) { notify("Дождись перевода перед очисткой."); return; }
    drafts = { ...EMPTY_DRAFTS }; save();
    for (const key of DIRECTIONS) { delete translations[key]; delete translationErrors[key]; }
    renderGuide(); notify("Сохранённые черновики очищены.");
  });
}
document.querySelectorAll<HTMLButtonElement>("[data-section]").forEach(button => button.addEventListener("click", () => {
  const next = parseSection(button.dataset.section);
  if (next) { section = next; render(); content.scrollTop = 0; }
}));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && overlayMode) { event.preventDefault(); void dismissOverlay().catch(error => notify(String(error))); }
  if (event.key === "Enter" && event.ctrlKey && section === "translate") { event.preventDefault(); void runTranslation(); }
});

async function initialize(): Promise<void> {
  if (role==="main") {try {await observeHistory(notify);}catch(error){notify(String(error));}}
  try {
    if (overlayMode) await observeScreenText(image => {
      direction = "auto-ru";
      drafts.autoRu = image.source;
      delete translations[direction]; delete translationErrors[direction];
      save("autoRu"); captureBusy = false;
      translations[direction] = image.translation;
      renderTranslate(); notify(image.sourceTruncated ? "Перевод готов. Длинный оригинал сокращён до 4 000 символов в поле ввода." : "Переведено по изображению");
    });
    await observeCapture(next => {
      captureBusy = next.busy ?? !["idle", "result", "error"].includes(next.phase);
      if (next.error) notify(next.error);
      if (section === "translate") renderTranslate();
    });
  } catch (error) { notify(String(error)); }
  try { await observeOverlay(applyOverlayView); } catch (error) { notify(String(error)); }
  try { await observeTranslations(applyTranslationState); } catch (error) { notify(String(error)); }
  try { await observeStatus(next => {
    if (status && !status.shortcutPending && next.shortcutPending) return;
    status = next;
    document.querySelector("#overlay-toggle")!.setAttribute("title", !overlayMode && next.shortcutRegistered ? `Открыть / скрыть · ${next.shortcut}` : overlayMode ? "Открыть программу" : "Открыть оверлей");
    if (section === "overlay") renderOverlayControls();
  }); }
  catch (error) { statusError = String(error); }
  const label = document.querySelector("#runtime-label")!;
  label.textContent = !native ? "◉ Предпросмотр · без Rust" : statusError ? "⚠ Rust недоступен" : "◉ Rust подключён";
  if (statusError) notify(statusError);
  if (status) {
    if (!status.shortcutPending && !status.shortcutRegistered) notify("Горячая клавиша недоступна. Оверлей можно открыть кнопкой или через значок в трее.");
  }
  if (section === "overlay") renderOverlayControls();
}
function applyTranslationState(snapshot: TranslationSnapshot): void {
  if (latestTranslation && snapshot.revision < latestTranslation.revision) return;
  latestTranslation = snapshot;
  busy = snapshot.busy;
  DIRECTIONS.forEach((key, index) => {
    const entry = snapshot.entries[index];
    delete translations[key]; delete translationErrors[key];
    if (entry?.source === drafts[draftKey(key)]) {
      if (entry.translation) translations[key] = entry.translation;
      if (entry.error) translationErrors[key] = entry.error;
    }
  });
  if (section === "translate") renderTranslate();
}
window.addEventListener("storage", event => {
  if (event.key === DRAFT_KEY || event.key === null) {
    drafts = restoreDrafts(event.newValue);
    if (latestTranslation) applyTranslationState(latestTranslation);
    else if (section === "translate") renderTranslate();
  }
});
document.querySelector("#overlay-toggle")!.addEventListener("click", () => {
  if (overlayMode) void showMain().catch(error => notify(String(error)));
  else void openTranslator(false);
});
document.querySelector("#overlay-close")!.addEventListener("click", () => void hideOverlay().catch(error => notify(String(error))));
document.querySelector<HTMLButtonElement>("#pin-panel")!.addEventListener("click", async event => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  try {
    await setPinned(!pinned);
  } catch (error) { notify(String(error)); }
  finally { button.disabled = false; }
});
render();
document.querySelector("#storage-label")!.textContent = storageAvailable ? "Черновики на устройстве" : "Черновики только до закрытия";
void initialize().then(() => reportFrontendReady(role)).catch(error => notify(String(error)));
