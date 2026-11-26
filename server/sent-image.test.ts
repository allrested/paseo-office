import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readSentImage, SENT_IMAGE_BYTES } from "./sent-image.js";

const NAME = `${"a".repeat(64)}.png`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("readSentImage", () => {
  let root: string;
  let folder: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "sent-image-test-"));
    folder = path.join(root, "paseo-attachments-AbC123");
    await mkdir(folder);
    await writeFile(path.join(folder, NAME), PNG);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const url = (...parts: string[]) => pathToFileURL(path.join(root, ...parts)).href;

  test("the daemon's copy of a sent image comes back as a data URL", async () => {
    expect(await readSentImage(url("paseo-attachments-AbC123", NAME), root)).toBe(
      `data:image/png;base64,${PNG.toString("base64")}`,
    );
  });

  test("a jpg copy is served as image/jpeg", async () => {
    const name = `${"b".repeat(64)}.jpg`;
    await writeFile(path.join(folder, name), PNG);
    expect(await readSentImage(url("paseo-attachments-AbC123", name), root)).toBe(
      `data:image/jpeg;base64,${PNG.toString("base64")}`,
    );
  });

  test("a file outside the daemon's attachment folders is refused", async () => {
    await mkdir(path.join(root, "other"));
    await writeFile(path.join(root, "other", NAME), PNG);
    await writeFile(path.join(root, NAME), PNG);
    expect(await readSentImage(url("other", NAME), root)).toBeNull();
    expect(await readSentImage(url(NAME), root)).toBeNull();
    expect(
      await readSentImage(url("paseo-attachments-AbC123", "..", "other", NAME), root),
    ).toBeNull();
  });

  test("a name the daemon would not have written is refused", async () => {
    await writeFile(path.join(folder, "notes.png"), PNG);
    await writeFile(path.join(folder, `${"a".repeat(64)}.svg`), PNG);
    expect(await readSentImage(url("paseo-attachments-AbC123", "notes.png"), root)).toBeNull();
    expect(
      await readSentImage(url("paseo-attachments-AbC123", `${"a".repeat(64)}.svg`), root),
    ).toBeNull();
  });

  test("a link that leaves the attachment folder is refused", async () => {
    const secret = path.join(root, "secret.png");
    await writeFile(secret, PNG);
    const name = `${"c".repeat(64)}.png`;
    await symlink(secret, path.join(folder, name));
    expect(await readSentImage(url("paseo-attachments-AbC123", name), root)).toBeNull();
  });

  test("a missing file, another scheme and an oversized file give nothing", async () => {
    expect(
      await readSentImage(url("paseo-attachments-AbC123", `${"d".repeat(64)}.png`), root),
    ).toBeNull();
    expect(await readSentImage("https://example.com/a.png", root)).toBeNull();
    expect(await readSentImage("not a url", root)).toBeNull();
    const name = `${"e".repeat(64)}.png`;
    await writeFile(path.join(folder, name), Buffer.alloc(SENT_IMAGE_BYTES + 1));
    expect(await readSentImage(url("paseo-attachments-AbC123", name), root)).toBeNull();
  });
});
