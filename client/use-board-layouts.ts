import { useCallback, useMemo } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { officeBoardsSettings, type BoardLayout } from "../shared/settings.js";

export interface BoardLayouts {
  lobby: BoardLayout;
  rooms: BoardLayout;
}

const DEFAULTS: BoardLayouts = { lobby: "kanban", rooms: "list" };

/** How the lobby's board and the rooms' boards are laid out on this device; the defaults until it is read. */
export function useBoardLayouts(): BoardLayouts {
  const settings = useSettings(officeBoardsSettings);
  const stored = settings.status === "ready" ? settings.values : null;
  const lobby = stored?.lobby ?? DEFAULTS.lobby;
  const rooms = stored?.rooms ?? DEFAULTS.rooms;
  return useMemo(() => ({ lobby, rooms }), [lobby, rooms]);
}

/** One board's choice, in the shape the settings chips take: `on` is null while the device's setting is not usable. */
export interface BoardChoice {
  on: BoardLayout | null;
  set(value: BoardLayout): void;
}

/** The two choices of the Boards section. Each save writes the document whole. */
export function useBoardLayoutChoices(): { lobby: BoardChoice; rooms: BoardChoice } {
  const settings = useSettings(officeBoardsSettings);
  const stored = settings.status === "ready" ? settings.values : null;
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const { save } = settings;
  const lobby = stored?.lobby ?? DEFAULTS.lobby;
  const rooms = stored?.rooms ?? DEFAULTS.rooms;
  const change = useCallback(
    (patch: Partial<BoardLayouts>) => {
      if (revision === null) return;
      void save({ lobby, rooms, ...patch }, revision);
    },
    [save, revision, lobby, rooms],
  );
  const setLobby = useCallback((value: BoardLayout) => change({ lobby: value }), [change]);
  const setRooms = useCallback((value: BoardLayout) => change({ rooms: value }), [change]);
  const usable = stored !== null;
  return useMemo(
    () => ({
      lobby: { on: usable ? lobby : null, set: setLobby },
      rooms: { on: usable ? rooms : null, set: setRooms },
    }),
    [usable, lobby, rooms, setLobby, setRooms],
  );
}
