import test from "node:test";
import assert from "node:assert/strict";
import { overlayStatus } from "../src/overlay-status";
test("opening does not claim success until native visibility and frontend readiness agree", () => {
  const view = { visible: false, ready: false, pinned: false, openError: null };
  assert.equal(overlayStatus(view, false, ""), "Оверлей скрыт");
  assert.equal(overlayStatus(view, true, ""), "Открываем переводчик…");
  assert.match(overlayStatus({ ...view, visible: true }, false, ""), /загружается/);
  assert.equal(overlayStatus({ ...view, visible: true, ready: true }, false, ""), "Переводчик открыт");
  assert.match(overlayStatus({ ...view, visible: true, ready: true, editing: true }, false, ""), /фон затемнён/);
  assert.match(overlayStatus({ ...view, visible: true, ready: true, pinned: true }, false, ""), /поверх игры · без затемнения/);
  assert.match(overlayStatus({ ...view, visible: true, ready: true }, false, "Timeout"), /Не удалось/);
  assert.match(overlayStatus({ ...view, openError: "Windows error" }, false, ""), /Не удалось/);
});
