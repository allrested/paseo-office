import { homedir } from "node:os";
import { beforeEach, expect, test, vi } from "vitest";

const execFile = vi.fn();
vi.mock("node:child_process", () => ({ execFile }));

beforeEach(() => {
  execFile.mockReset();
  execFile.mockImplementation((_file, _args, _options, done) => done(null, "[]", ""));
});

test("gh runs without a shell, on github.com, never prompting, from the home directory", async () => {
  process.env.GH_HOST = "ghe.example.test";
  const { runGh } = await import("./intake-github.js");
  const args = ["issue", "list", "--repo", "acme/web"];
  expect(await runGh(args)).toEqual({ code: 0, stdout: "[]", stderr: "" });
  const [file, given, options] = execFile.mock.calls[0] ?? [];
  expect(file).toBe("gh");
  expect(given).toEqual(args);
  expect(options).toMatchObject({
    cwd: homedir(),
    timeout: 30_000,
    maxBuffer: 8_000_000,
    env: { GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
  });
  expect(options.env.PATH).toContain(".local/bin");
  expect(options.shell).toBeUndefined();
  delete process.env.GH_HOST;
});
