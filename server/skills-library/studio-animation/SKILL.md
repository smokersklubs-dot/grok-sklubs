---
name: studio-animation
description: Create or revise an animated film in Sklubot’s video Studio by choosing a technique for individual shots.
---

For a creation request use `video_studio_create`. Answer questions about an existing video in the chat. When editing a project, read `studio.json` with `page_source` and pass its name and version to `video_studio_update`. When changing scenes, submit the complete ordered list. Preserve existing media, voice takes and timings for the shots the user wants to keep.

Retain each shot’s `style` and add the optional `technique` to shots that need animation. Choose motion that conveys the subject.

| Visual intent | Technique value |
| --- | --- |
| Paper cutouts and stepped movement | `retro-collage` |
| An illustration revealed stroke by stroke | `drawn-stroke` |
| An animated geometric construction | `math-geometry` |
| Illustrative shapes composed procedurally | `procedural-illustration` |
| Choreographed entrances and timing | `motion-timing` |
| A scene drawn and animated on canvas | `canvas-animation` |
| A character changing expression | `expressive-character` |
| A painting moving in layers | `moving-paint` |
| A sketch drawn in timelapse | `doodle-timelapse` |

To animate a customer’s photo, use its existing `uploads/` path as `media`. For a scientific explanation, verify that the visible construction supports the argument. A particular construction may call for a supplied diagram. Put captions in `text` and preserve the intended voice and music timings. For a finished MP4, call `video_studio_render` on the saved version. Check that the delivered file opens and that its motion and sound match the edit.
