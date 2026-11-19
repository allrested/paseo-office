// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { test, vi, expect } from "vitest";
import { useStreetKit } from "./use-street-kit.js";
const load = vi.hoisted(() => vi.fn());
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => load }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
test("loads only on demand, retries on re-enable and reuses a successful kit", async () => {
  const root = createRoot(document.createElement("div"));
  let status: ReturnType<typeof useStreetKit> | undefined;
  function Probe({ on }: { on: boolean | null }) {
    status = useStreetKit(on);
    return null;
  }
  const mount = (on: boolean | null) => act(async () => root.render(<Probe on={on} />));
  await mount(null);
  await mount(false);
  expect(status).toEqual({ status: "off" });
  expect(load).not.toHaveBeenCalled();
  load.mockRejectedValueOnce(Error("offline"));
  await mount(true);
  expect(status).toEqual({ status: "failed" });
  await mount(false);
  load.mockResolvedValueOnce("");
  await mount(true);
  expect(status).toEqual({ status: "failed" });
  await mount(false);
  load.mockResolvedValueOnce("cars");
  await mount(true);
  expect(status).toEqual({ status: "ready", kit: "cars" });
  await mount(false);
  await mount(true);
  expect(load).toHaveBeenCalledTimes(3);
  await act(async () => root.unmount());
});
