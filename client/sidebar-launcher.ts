// Paseo can keep earlier screens and workspace tabs mounted. Each installation only
// offers the sidebar press to its own surfaces, until a visible one handles it.
export function createSidebarLauncher() {
  const surfaces = new Set<() => boolean>();
  let openingScreen = false;
  return {
    register(activate: () => boolean) {
      surfaces.add(activate);
      return () => {
        surfaces.delete(activate);
      };
    },
    takeScreenLaunch() {
      const pending = openingScreen;
      openingScreen = false;
      return pending;
    },
    open() {
      openingScreen = false;
      for (const activate of surfaces) {
        if (activate()) return true;
      }
      openingScreen = true;
      return false;
    },
  };
}

export type SidebarLauncher = ReturnType<typeof createSidebarLauncher>;
