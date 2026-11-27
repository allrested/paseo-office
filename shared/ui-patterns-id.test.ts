import { expect, test } from "vitest";
import { translatePattern } from "./ui-patterns-id.js";

test("lines built from data keep their data and take Indonesian words", () => {
  const lines: [string, string][] = [
    ["12 min ago", "12 mnt lalu"],
    ["3 h ago", "3 jam lalu"],
    ["just now", "baru saja"],
    ["2 h 5 min", "2 jam 5 mnt"],
    ["Idle for 45 min", "Menganggur selama 45 mnt"],
    ["Waiting on 2 sub-agents", "Menunggu 2 sub-agen"],
    ["Sub-agent of Builder", "Sub-agen dari Builder"],
    ["Context 28%", "Konteks 28%"],
    ["All sessions · 8", "Semua sesi · 8"],
    ["3/7 tasks", "3/7 tugas"],
    ["2 open · a check failed", "2 terbuka · satu pemeriksaan gagal"],
    ["Jira SHOP-12: Checkout fails · 2 more open", "Jira SHOP-12: Checkout fails · 2 lagi terbuka"],
    ["Checkout is stuck in a loop", "Checkout terjebak dalam perulangan"],
    ["Task · claimed by Builder", "Tugas · diambil oleh Builder"],
    ["Replay · 14:05 · 60×", "Putar ulang · 14:05 · 60×"],
    ["3 h 20 min at work", "3 jam 20 mnt bekerja"],
    ["1.5 GB free", "1.5 GB kosong"],
  ];
  for (const [english, indonesian] of lines) expect(translatePattern(english)).toBe(indonesian);
});

test("a failure reads in Indonesian up to the host's own reason", () => {
  expect(translatePattern("Unable to dismiss: The host is offline")).toBe(
    "Tidak dapat abaikan: The host is offline",
  );
  expect(translatePattern("Unable to send a test: The webhook answered 403")).toBe(
    "Tidak dapat kirim tes: The webhook answered 403",
  );
  expect(translatePattern("Unable to load the office")).toBe("Tidak dapat memuat kantor");
});

test("a title, a message or a name that only ends like one of the office's lines is left alone", () => {
  for (const said of [
    "Check why the login failed",
    "Fix the platform team",
    "Update the release board",
    "Message queue retries",
    "Who has it",
    "Notes for the payments team",
    "Deploy LoyaPro services to agent s",
  ]) {
    expect(translatePattern(said)).toBe(said);
  }
});
