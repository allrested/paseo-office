// @vitest-environment jsdom
// The clip's music (ui/clip-music.js, upstream's). The tune is pure code; the context that carries it into the recording
// is made only while the Sound setting is on.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ sfx: { on: false } }));
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({ sfx: h.sfx }));

import {
  lofi,
  musicTrack,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/clip-music.js";

/** A page's audio, as far as the clip reads it. */
function stubAudio() {
  const made = { contexts: 0, started: 0, resumed: 0, trackStopped: 0 };
  const track = { stop: () => (made.trackStopped += 1) };
  class FakeContext {
    sampleRate = 8000;
    constructor() {
      made.contexts += 1;
    }
    createBuffer(_channels: number, length: number) {
      return { length, copyToChannel() {} };
    }
    createBufferSource() {
      return { connect() {}, start: () => (made.started += 1), stop() {} };
    }
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [track] } };
    }
    resume() {
      made.resumed += 1;
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return made;
}

beforeEach(() => {
  h.sfx.on = false;
});
afterEach(() => vi.unstubAllGlobals());

test("the tune is two channels of samples, deterministic, and never over 0.9", () => {
  const [left, right] = lofi(1, 8000) as [Float32Array, Float32Array];
  expect(left).toHaveLength(8000);
  expect(right).toHaveLength(8000);
  const peak = Math.max(...left.map(Math.abs), ...right.map(Math.abs));
  expect(peak).toBeGreaterThan(0.5);
  expect(peak).toBeLessThan(0.9);
  const [again] = lofi(1, 8000) as [Float32Array, Float32Array];
  expect(Array.from(again.slice(0, 200))).toEqual(Array.from(left.slice(0, 200)));
});

test("with Sound off there is no music track and no audio context", () => {
  const made = stubAudio();
  expect(musicTrack(1)).toBeNull();
  expect(made.contexts).toBe(0);
});

test("with Sound on the music is a track for the recorder, started with the clip", () => {
  const made = stubAudio();
  h.sfx.on = true;
  const music = musicTrack(1);
  expect(music).not.toBeNull();
  expect(made.contexts).toBe(1);
  music.start();
  expect(made.started).toBe(1);
  expect(made.resumed).toBe(1);
  music.stop();
  expect(made.trackStopped).toBe(1);
});

test("with Sound on but no audio in the browser it is no track", () => {
  h.sfx.on = true;
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("webkitAudioContext", undefined);
  expect(musicTrack(1)).toBeNull();
});
