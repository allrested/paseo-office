import { createContext } from "react";

/** Opens the Timeline card; absent while the office's data is not live. */
export const OpenTimelineContext = createContext<(() => void) | undefined>(undefined);

/** Opens the History card; absent while the office's data is not live. */
export const OpenHistoryContext = createContext<(() => void) | undefined>(undefined);
