import test from 'node:test';
import assert from 'node:assert/strict';
import { screenRegion, translationPlacement, textBlockPlacement } from '../src/screen-region';
test('screen selection works in any drag direction and clamps to viewport', () => {
  const expected = { left: .1, top: .2, right: .8, bottom: .6 };
  assert.deepEqual(screenRegion({ x: 80, y: 60 }, { x: 10, y: 20 }, 100, 100), expected);
  assert.deepEqual(screenRegion({ x: 10, y: 60 }, { x: 80, y: 20 }, 100, 100), expected);
  assert.deepEqual(screenRegion({ x: -10, y: -20 }, { x: 110, y: 120 }, 100, 100), { left: 0, top: 0, right: 1, bottom: 1 });
  assert.equal(screenRegion({ x: 5, y: 5 }, { x: 7, y: 50 }, 100, 100), null);
  assert.equal(screenRegion({ x: NaN, y: 5 }, { x: 7, y: 50 }, 100, 100), null);
  assert.equal(screenRegion({ x: 5, y: 5 }, { x: 7, y: 50 }, 0, 100), null);
});
test('translated chat stays over its area and small edge selections remain readable on screen', () => {
  const area = translationPlacement({ left: .1, top: .2, right: .8, bottom: .6 }, 1000, 800)!;
  assert.equal(area.left, 100); assert.equal(area.top, 160);
  assert(Math.abs(area.width - 700) < .001 && Math.abs(area.height - 320) < .001);
  const edge = translationPlacement({ left: .99, top: .99, right: 1, bottom: 1 }, 1000, 800)!;
  assert.equal(edge.left + edge.width, 1000); assert.equal(edge.top + edge.height, 800);
  assert.equal(translationPlacement({ left: -1, top: 0, right: 1, bottom: 1 }, 100, 100), null);
});
test('full screen translation uses a readable centred panel on 2K and smaller viewports', () => {
  for (const [width, height] of [[2560, 1440], [3840, 2160], [320, 240]]) {
    const area = translationPlacement({ left: 0, top: 0, right: 1, bottom: 1 }, width, height)!;
    assert(area.width <= 760 && area.height <= 800);
    assert(area.left > 0 && area.top > 0);
    assert(area.left + area.width < width && area.top + area.height < height);
    assert.equal(area.left * 2 + area.width, width);
  }
});
test('text block placement covers original ink and remains inside the viewport', () => {
  const placed = textBlockPlacement({ left:.1,top:.2,right:.4,bottom:.3 },1000,800)!;
  assert(placed.left <= 100 && placed.top <= 160);
  assert(placed.left + placed.width >= 400 && placed.top + placed.height >= 240);
  const edge = textBlockPlacement({ left:.999,top:.999,right:1,bottom:1 },2560,1440)!;
  assert.equal(edge.left + edge.width,2560); assert.equal(edge.top + edge.height,1440);
  assert.equal(textBlockPlacement({ left:0,top:0,right:2,bottom:1 },1000,800),null);
  assert.equal(textBlockPlacement({ left:0,top:NaN,right:1,bottom:1 },1000,800),null);
});
