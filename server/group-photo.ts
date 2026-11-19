import { GroupPhotoSchema } from "../shared/contracts.js";

/** Check the JPEG's frame size before keeping or broadcasting a client's data URL. */
export function isOfficePhoto(data: string): boolean {
  if (!GroupPhotoSchema.safeParse(data).success) return false;
  const encoded = data.slice("data:image/jpeg;base64,".length);
  const image = Buffer.from(encoded, "base64");
  if (
    image.length < 16 ||
    image.toString("base64") !== encoded ||
    image.readUInt16BE(image.length - 2) !== 0xffd9
  )
    return false;
  let framed = false;
  for (let at = 2; at + 4 <= image.length; ) {
    if (image[at] !== 0xff) return false;
    if (image[at + 1] === 0xff) {
      at++;
      continue;
    }
    const marker = image[at + 1];
    const length = image.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > image.length - 2) return false;
    if (marker === 0xda) return framed && length >= 6 && at + 2 + length < image.length - 2;
    if (marker === 0xc0 || marker === 0xc2) {
      if (
        framed ||
        length < 11 ||
        image[at + 4] !== 8 ||
        image.readUInt16BE(at + 5) !== 360 ||
        image.readUInt16BE(at + 7) !== 480
      )
        return false;
      framed = true;
    }
    at += length + 2;
  }
  return false;
}
