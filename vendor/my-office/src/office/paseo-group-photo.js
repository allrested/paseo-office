// PASEO: the group composer's chatPhoto(null) crop from upstream ui/group-chat.js, using the
// current camera and the same quality pass as the scene's rendering loop.
import { fp } from './interact/first-person.js';
import { camera, fpCam, renderer } from './scene/renderer.js';
import { drawFrame } from './scene/quality.js';

export function captureGroupPhoto() {
  if (!renderer || renderer.getContext().isContextLost()) return null;
  const source = renderer.domElement;
  if (!source.width || !source.height) return null;
  drawFrame(fp.on ? fpCam : camera);
  const width = Math.min(source.width, source.height * 4 / 3), height = width * 3 / 4;
  const canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, (source.width - width) / 2, (source.height - height) / 2, width, height, 0, 0, 480, 360);
  for (const quality of [0.8, 0.55, 0.35]) {
    const data = canvas.toDataURL('image/jpeg', quality);
    if (data.startsWith('data:image/jpeg;base64,') && data.length <= 96000) return data;
  }
  return null;
}
