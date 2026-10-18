# Synthetic image translation fixture

`ocr-chat.bgra` contains 600×100 BGRA8 pixels generated locally with Canvas:
white background, black32px Arial text `Ahoj kde je zelezo` at20,60.
It contains no captured desktop or user data. PNG encoding and temporary-file
tests consume this image without calling desktop capture. The explicit
`node scripts/live-vision.mjs` test sends its PNG version to Codex and checks
the original word Ahoj plus the Russian translation of zelezo.

The original filename is retained from the earlier Windows OCR experiment.
Windows OCR is no longer in the runtime. Real Minecraft fonts, backgrounds
and Slovak diacritics remain owner tests; this fixture proves attachment and
translation work, not real-game reading accuracy.

Spatial overlay stage: the live fixture test also checks that model-provided normalized boxes cover at least75% of known black text pixels and do not cover the whole image. This is a synthetic geometry smoke test, not a guarantee for real interfaces.

screen-layout.png is a locally drawn 1000x600 synthetic layout with Welcome, Find iron near the cave, PLAY, Settings and Return in separated places. It contains no captured desktop or user data. live-vision --layout-only checks separate blocks, valid Russian label variants and upper-right/lower-left placement.

cursor-lines.png is a locally drawn800x220 image with Buy iron, Sell gold and Teleport home on separate rows. live-cursor-line checks a point on Sell gold while rejecting a blank far-away point. No user data/desktop capture.
