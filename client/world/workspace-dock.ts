import { createContext } from "react";

// The fullscreen surface owns the window; the camera toolbar lives in its scene iframe.
export const RegisterWorkspaceDock = createContext<
  ((button: HTMLButtonElement | null) => void) | null
>(null);
