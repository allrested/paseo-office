// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { OfficeStyles } from "./styles.js";
import { WorkspaceOverlay } from "./workspace-overlay.js";

vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: () => null }));
vi.mock("./office-modal.js", () => ({
  useFullscreenDialog: () => true,
  OfficeModal: Object.assign(
    ({ headerActions, children }: { headerActions: ReactNode; children: ReactNode }) => (
      <>
        {headerActions}
        {children}
      </>
    ),
    { Content: ({ children }: { children: ReactNode }) => children },
  ),
}));

const styles = {} as OfficeStyles;

test("a session arrow reopens the workbench even after Office controls were selected in that workspace", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  const render = (request: object) =>
    act(async () => {
      root.render(
        <WorkspaceOverlay
          dockRequest={request}
          hostId="host"
          workspaceId="ws"
          agentId="agent"
          title="Workspace"
          platform="web"
          styles={styles}
          onClose={close}
        >
          Office controls content
        </WorkspaceOverlay>,
      );
    });
  try {
    await render({});
    const frame = host.querySelector("iframe")!;
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Office controls"]')!.click(),
    );
    expect(frame.style.display).toBe("none");
    await render({});
    expect(host.querySelector("iframe")).toBe(frame);
    expect(frame.style.display).not.toBe("none");
    expect(host.querySelector('[aria-label="Paseo workspace"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
