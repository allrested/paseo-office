import { createServer, type RequestListener } from "node:http";
import { afterEach, expect, test } from "vitest";
import { createWeatherReader } from "./weather-read.js";
const cleanup: (() => Promise<void>)[] = [];
async function endpoint(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing port");
  return "http://127.0.0.1:" + address.port + "/?key=SECRET";
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
test("reads a loopback JSON endpoint with no credentials and clamps cloud cover", async () => {
  const url = await endpoint((req, res) => {
    expect(req.headers.accept).toBe("application/json");
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers.cookie).toBeUndefined();
    res.end(
      JSON.stringify({
        current: { weather_code: 63, temperature_2m: 14.2, cloud_cover: 120, is_day: 0 },
      }),
    );
  });
  expect(await createWeatherReader()(url)).toEqual({ code: 63, temp: 14.2, cloud: 1 });
});
test.each([
  [301, "secret", "redirect (HTTP 301)"],
  [503, "SECRET", "HTTP 503"],
  [200, "SECRET", "needs current.weather_code and current.temperature_2m"],
  [200, "x".repeat(65_537), "larger than 64 KB"],
  [
    200,
    JSON.stringify({ current: { weather_code: 100, temperature_2m: 1 } }),
    "needs current.weather_code",
  ],
])(
  "reports status and format without including service data, case %#",
  async (status, body, reason) => {
    let requests = 0;
    const url = await endpoint((_req, res) => {
      requests++;
      res.writeHead(Number(status), { Location: "/?key=SECRET" });
      res.end(body);
    });
    const error = await createWeatherReader()(url).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(reason);
    expect(String(error)).not.toMatch(/SECRET|127\.0\.0\.1/);
    expect(requests).toBe(1);
  },
);
test("bounds both waiting for headers and streaming the answer", async () => {
  for (const sendHeaders of [true, false]) {
    const url = await endpoint((_req, res) => {
      if (sendHeaders) res.write("{");
    });
    await expect(createWeatherReader({ timeoutMs: 100 })(url)).rejects.toThrow(
      "did not answer in 0.1 s",
    );
  }
});
