# ROT image prompts

Ticker: **$ROT**. Look: direction A, "Greenhouse night". Use these with any image generator. Paste the **style lock** at the start of every prompt so the set stays consistent.

## Style lock (paste first, every time)

```
Flat vector illustration, thick uniform outlines, few shapes, matte colors, no gradients, no glow, no text unless stated. Palette only: deep night green #0F1D17, coin green #2A5E4D, verdigris #6FC3A3, mid verdigris #4FA88A, bone #E9E5D2, soil #16281F, near-black #0B1410. Calm, slightly funny, greenhouse at night mood. No blobs or metaball shapes. No real brands, no celebrities, no copyrighted characters.
```

Negative prompt (if the tool has one): `photorealistic, 3D render, neon, glitch, gradient, blob, metaball, watermark, extra text, human face, real logo`

---

## 1. Polished logo

```
[style lock] A round coin seen straight on, thick verdigris rim, deep green face, a black crack running up from the bottom edge to the middle of the coin, and a small sprout growing out of the crack: a bone-colored stem with one bone leaf on the left and one larger verdigris leaf on the right. Centered on a night-green circle. Simple enough to read at 32 pixels. No text.
```
Reference: `rot-logo.svg`. If the generator drifts from it, trace the SVG instead.

## 2. Avatar (X and Telegram, 1:1)

```
[style lock] The ROT coin mark centered and filling 85 percent of a perfect circle, deep night-green background, nothing else. Crisp edges, readable at 48 pixels.
```
Export 1024 x 1024, crop to a circle, check that the sprout is still visible at 48 px.

## 3. Banner (X header, 3:1, 1500 x 500)

```
[style lock] Wide greenhouse scene at night. A strip of dark soil along the bottom. On the left third, a row of five coins in stages of decay from fresh to dust: fresh coin, tarnished coin, coin with verdigris patches, cracked coin, a small pile of dust. On the right, from the dust pile, a single sprout grows up with two leaves. Empty dark space in the middle for text. Flat, minimal, lots of negative space. No text.
```
Place the wordmark `rot` and the line "Dead bags rot. Rot feeds the next." on top in the editor, in a serif for the headline and a mono for small text.

## 4. Open Graph card (1200 x 630)

```
[style lock] Single large coin on the right, half covered in verdigris, cracked, with a small sprout on top. Empty left half in dark green for headline text. A thin soil line at the bottom. No text.
```
Add the headline "Dead bags rot. Rot feeds the next." in the editor.

## 5. Icon set (six icons, transparent background, 256 x 256 each)

Use this base for each, one prompt per icon:

```
[style lock] Single icon, centered, transparent background, verdigris outline with bone details, thick rounded strokes: <ICON>
```

| Icon | `<ICON>` |
|---|---|
| Find | `a magnifying glass over a small coin` |
| Burn | `a coin dropping into a bin with a wide open mouth` |
| Rot | `a coin with a crack and two small verdigris patches` |
| Ledger | `an open book with three short lines on each page` |
| Verify | `a check mark inside a small coin` |
| Sprout | `a stem with two leaves coming out of a small mound of soil` |

## 6. Stage plates for the static fallback (square, 1:1, 1024 x 1024)

Five images, one per stage. Same framing, same coin position, transparent background.

```
[style lock] The ROT coin straight on, centered. Stage: <STAGE>
```

| Stage | `<STAGE>` |
|---|---|
| 0 fresh | `a clean bronze-green coin with a raised ring and a raised letter R, bright rim` |
| 1 tarnished | `the same coin, darker and duller, fine speckles, rim slightly worn` |
| 2 cracked | `verdigris patches across the face, two dark cracks, a few pits` |
| 3 dust | `the coin has broken apart into a low pile of dust and three coin fragments on soil` |
| 4 sprout | `the pile of dust with a small sprout growing from the middle, two leaves` |

## 7. Stickers (transparent, die-cut look, 512 x 512)

Add `white sticker outline, die-cut, transparent background` to the style lock. One prompt each:

1. `A coin wearing a tiny frown with a sprout growing from its head. No text.`
2. `A trash can with a sprout growing out of the lid. No text.`
3. `A coin lying in a small flowerpot of soil, labeled with a small tag that says "rot" in lowercase hand lettering.`
4. `A cracked coin giving a thumbs-up with a bone-colored glove-hand. No text.`
5. `A coin tombstone with a sprout growing next to it. The stone reads "rip" in lowercase.`
6. `Five coins in a row going from shiny to dusty, then a sprout. No text.`

## 8. Rules for all assets

- No real brands, celebrities, films or copyrighted characters. No lookalikes of existing coin mascots.
- Keep the palette. If a generated image adds new colors, recolor it before using it.
- Do not show price charts, rocket ships or money bags. They contradict the tone and imply promises the site doesn't make.
- Check each avatar-size asset at 48 px before publishing.
