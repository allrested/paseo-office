import type { Machine, MachineEvent } from "../../shared/contracts.js";
import { errorMessage } from "../errors.js";
import type { Timers } from "../timers.js";

/** Memory and ports change slowly, and a reading walks every process on the host. */
export const MACHINE_INTERVAL_MS = 10_000;
/** With no office open and the host kept watched: enough for the 30-minute history and an alert. */
export const MACHINE_BACKGROUND_MS = 60_000;

export interface MachineSubscriber {
  push(event: MachineEvent): Promise<void>;
  signal: AbortSignal;
}

export interface MachineWatchPorts {
  /** Null on a host that cannot be read. */
  read(): Promise<Machine | null>;
  timers: Timers;
  log(message: string): void;
}

export interface MachineWatch {
  /** Streams readings to one subscriber. Resolves when its signal aborts. */
  attach(subscriber: MachineSubscriber): Promise<void>;
  /** On: reads with no subscriber too, every minute, so the history has no gap. Off: only for subscribers. */
  keep(on: boolean): void;
  /** Reads now, ahead of the timer: something was just cleaned up. */
  refresh(): void;
  stop(): void;
}

/**
 * Reads the host while someone listens: now, then every interval after the read before it. Kept
 * watched, it goes on at a slower pace with no one listening.
 */
export function createMachineWatch(ports: MachineWatchPorts): MachineWatch {
  const subscribers = new Set<MachineSubscriber>();
  let latest: MachineEvent | null = null;
  let cancel: (() => void) | null = null;
  let reading = false;
  let again = false;
  let kept = false;
  // Moves on whenever the last subscriber leaves, so a read that was under way then is dropped.
  let generation = 0;

  function send(subscriber: MachineSubscriber, event: MachineEvent): void {
    if (subscriber.signal.aborted) return;
    subscriber
      .push(event)
      .catch((error: unknown) => ports.log(`[office] machine push failed: ${errorMessage(error)}`));
  }

  async function run(): Promise<void> {
    const mine = generation;
    cancel = null;
    reading = true;
    let event: MachineEvent | null = null;
    try {
      const machine = await ports.read();
      event = machine === null ? { type: "unavailable" } : { type: "reading", machine };
    } catch (error) {
      ports.log(`[office] machine reading failed: ${errorMessage(error)}`);
    }
    reading = false;
    if (mine !== generation) {
      // Everyone left during the read. Someone who came since waits for a read of their own.
      if (subscribers.size > 0) start();
      else if (kept) cancel = ports.timers.setTimeout(start, MACHINE_BACKGROUND_MS);
      return;
    }
    if (event !== null) {
      latest = event;
      for (const subscriber of subscribers) send(subscriber, event);
    }
    // A host without /proc never gets one: the answer stands, and nothing is read again.
    if (event?.type === "unavailable") return;
    if (again) {
      again = false;
      start();
    } else {
      const wait = subscribers.size > 0 ? MACHINE_INTERVAL_MS : MACHINE_BACKGROUND_MS;
      cancel = ports.timers.setTimeout(start, wait);
    }
  }

  function start(): void {
    run().catch((error: unknown) => ports.log(`[office] machine failed: ${errorMessage(error)}`));
  }

  function leave(subscriber: MachineSubscriber): void {
    subscribers.delete(subscriber);
    if (subscribers.size > 0) return;
    generation += 1;
    cancel?.();
    cancel = null;
    const readable = latest?.type !== "unavailable";
    latest = null;
    again = false;
    if (kept && readable && !reading)
      cancel = ports.timers.setTimeout(start, MACHINE_BACKGROUND_MS);
  }

  return {
    attach(subscriber) {
      if (subscriber.signal.aborted) return Promise.resolve();
      subscribers.add(subscriber);
      if (latest !== null) {
        send(subscriber, latest);
        // What a background read left is up to a minute old: this office gets a read of its own.
        if (kept && !reading && latest.type !== "unavailable") {
          cancel?.();
          start();
        }
      } else if (!reading && cancel === null) start();
      return new Promise((resolve) => {
        subscriber.signal.addEventListener(
          "abort",
          () => {
            leave(subscriber);
            resolve();
          },
          { once: true },
        );
      });
    },
    keep(on) {
      if (kept === on) return;
      kept = on;
      if (on) {
        if (
          subscribers.size === 0 &&
          !reading &&
          cancel === null &&
          latest?.type !== "unavailable"
        ) {
          start();
        }
      } else if (subscribers.size === 0) {
        generation += 1;
        cancel?.();
        cancel = null;
        latest = null;
        again = false;
      }
    },
    refresh() {
      if (subscribers.size === 0 || latest?.type === "unavailable") return;
      if (reading) {
        again = true;
        return;
      }
      cancel?.();
      start();
    },
    stop() {
      // Deleting the member a Set's iterator stands on is safe.
      for (const subscriber of subscribers) leave(subscriber);
    },
  };
}
