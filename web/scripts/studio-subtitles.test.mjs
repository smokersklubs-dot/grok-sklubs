import assert from "node:assert/strict";
import { test } from "node:test";
import { studioSubtitles } from "../src/lib/studioSubtitles.ts";
import { validStory } from "../src/lib/studioStory.ts";

test("subtitle times follow the edited timeline, including untitled shots and minute rollover", () => {
  const scenes = [{ text: "  ", seconds: 59.999 }, { text: "Été & hiver\r\n\r\n<ici>", seconds: 0.501 }, { text: "Fin", seconds: 1.25 }];
  assert.equal(studioSubtitles({ scenes }, "vtt"), "WEBVTT\n\n00:00:59.999 --> 00:01:00.500\nÉté &amp; hiver\n&lt;ici&gt;\n\n00:01:00.500 --> 00:01:01.750\nFin\n");
  assert.match(studioSubtitles({ scenes }, "srt"), /^1\n00:00:59,999 --> 00:01:00,500[\s\S]+\n\n2\n00:01:00,500 --> 00:01:01,750\nFin\n$/);
});

test("generated workspace audio can play without allowing a different bot's folder", () => {
  const story = { title: "Voice", scenes: [{ text: "OK", seconds: 1, style: "type", media: "" }], aspect: "wide", audio: "audio/voice-id.wav", offset: 0, muted: false };
  assert.equal(validStory(story), true);
  assert.equal(validStory({ ...story, audio: "uploads/music.mp3" }), true);
  assert.equal(validStory({ ...story, audio: "audio/../other/voice.wav" }), false);
});
