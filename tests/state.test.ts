import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreDrafts, draftKey, parseSection, EMPTY_DRAFTS, DIRECTIONS, languagePair, selectLanguage, mergeDraftChange } from "../src/state.ts";

test("untrusted saved drafts recover without crashing", () => {
  for (const raw of [null, "broken", "null", "[]", '"string"', '{"incoming":42}']) {
    assert.deepEqual(restoreDrafts(raw), EMPTY_DRAFTS);
  }
});
test("Slovak and Russian drafts survive independently with a size limit", () => {
  const drafts = restoreDrafts(JSON.stringify({ incoming: "Kde je železo?", outgoing: "Где железо?", question: "č".repeat(13_000), game: "Minecraft 1.21" }));
  assert.equal(drafts.incoming, "Kde je železo?");
  assert.equal(drafts.outgoing, "Где железо?");
  assert.equal(drafts.question.length, 12_000);
  assert.equal(drafts.game, "Minecraft 1.21");
  assert.equal(draftKey("sk-ru"), "incoming");
  assert.equal(draftKey("ru-sk"), "outgoing");
});
test("navigation accepts only known sections", () => {
  for (const key of ["translate", "assistant", "browser", "guide"]) assert.equal(parseSection(key), key);
  assert.equal(parseSection("__proto__"), null);
  assert.equal(parseSection(undefined), null);
});

test("manual pairs swap correctly and all nine draft slots remain independent", () => {
  const keys = DIRECTIONS.map(draftKey);
  assert.equal(new Set(keys).size, 9);
  const drafts = restoreDrafts(JSON.stringify({ incoming: "Ahoj", outgoing: "Привет" }));
  for (const direction of DIRECTIONS) {
    const [source, target] = languagePair(direction);
    assert.notEqual(source, target);
    if (source !== "auto") {
      assert.equal(selectLanguage(direction, "source", target), `${target}-${source}`);
      assert.equal(selectLanguage(direction, "target", source), `${target}-${source}`);
    }
    assert.equal(selectLanguage(direction, "source", "__proto__"), direction);
    drafts[draftKey(direction)] = `draft:${direction}`;
  }
  const restored = restoreDrafts(JSON.stringify(drafts));
  for (const direction of DIRECTIONS) assert.equal(restored[draftKey(direction)], `draft:${direction}`);
  const merged = mergeDraftChange(restored, { ...EMPTY_DRAFTS, enRu: "Hello" }, "enRu");
  assert.equal(merged.enRu, "Hello");
  assert.equal(merged.incoming, "draft:sk-ru");
  assert.equal(merged.ruEn, "draft:ru-en");
  assert.equal(restoreDrafts('{"enRu":42,"ruEn":"Hello"}').enRu, "");
});

test("automatic source preserves target choice, rejects auto target and keeps legacy drafts", () => {
  assert.equal(selectLanguage("sk-ru", "source", "auto"), "auto-ru");
  assert.equal(selectLanguage("auto-ru", "target", "en"), "auto-en");
  assert.equal(selectLanguage("auto-en", "target", "sk"), "auto-sk");
  assert.equal(selectLanguage("auto-ru", "target", "auto"), "auto-ru");
  assert.equal(selectLanguage("auto-ru", "source", "ru"), "ru-sk");
  assert.equal(selectLanguage("auto-en", "source", "en"), "en-ru");
  assert.equal(selectLanguage("auto-ru", "source", "en"), "en-ru");
  const old = restoreDrafts('{"incoming":"Ahoj","outgoing":"Привет"}');
  assert.equal(old.incoming, "Ahoj"); assert.equal(old.autoRu, "");
  const restored = restoreDrafts(JSON.stringify({...old, autoRu:"Hallo", autoSk:"Hello", autoEn:"Привет"}));
  assert.equal(restored.autoRu, "Hallo"); assert.equal(restored.autoSk, "Hello"); assert.equal(restored.autoEn, "Привет");
});
