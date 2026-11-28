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
    ["To do · 3", "Akan dikerjakan · 3"],
    ["In progress · 1", "Sedang dikerjakan · 1"],
    ["Done · 0", "Selesai · 0"],
    ["Notes · 2", "Catatan · 2"],
    ["Needs you · 1", "Butuh Anda · 1"],
    ["Waiting · 4", "Menunggu · 4"],
    ["1 needs you", "1 butuh Anda"],
    ["2 need you · 1 stalled", "2 butuh Anda · 1 macet"],
    ["Builder is idle", "Builder menganggur"],
    ["3 need you", "3 butuh Anda"],
    ["Needs you: Which region?", "Butuh Anda: Which region?"],
    ["Builder needs: Which region?", "Builder butuh: Which region?"],
    ["3/7 tasks", "3/7 tugas"],
    ["2 open · a check failed", "2 terbuka · satu pemeriksaan gagal"],
    ["Jira SHOP-12: Checkout fails · 2 more open", "Jira SHOP-12: Checkout fails · 2 lagi terbuka"],
    ["Checkout is stuck in a loop", "Checkout terjebak dalam perulangan"],
    ["Task · claimed by Builder", "Tugas · diambil oleh Builder"],
    ["Replay · 14:05 · 60×", "Putar ulang · 14:05 · 60×"],
    ["3 h 20 min at work", "3 jam 20 mnt bekerja"],
    ["1.5 GB free", "1.5 GB kosong"],
    [
      "Undo the last turn's edits to 3 files?",
      "Urungkan suntingan giliran terakhir pada 3 berkas?",
    ],
    ["1 file restored, 0 skipped", "1 berkas dikembalikan, 0 dilewati"],
    ["2 files changed after the turn", "2 berkas diubah setelah giliran"],
    ["1 file left alone, being a link", "1 berkas dibiarkan karena berupa tautan"],
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

test("the cards' longer lines are in Indonesian too, with their names and numbers kept", () => {
  const lines: [string, string][] = [
    ["claude does not report its context", "claude tidak melaporkan konteksnya"],
    ["2 agents left something running", "2 agen meninggalkan sesuatu yang berjalan"],
    [
      "12 skills on this host, 4 in the teams' workspaces.",
      "12 skill di host ini, 4 di workspace tim.",
    ],
    ["Jira connection saved on this host", "Koneksi Jira tersimpan di host ini"],
    ["No Sentry connection on this host", "Belum ada koneksi Sentry di host ini"],
    ["3 open, 1 to review", "3 terbuka, 1 untuk ditinjau"],
    ["Changes requested on #12", "Perubahan diminta pada #12"],
    ["Checks fail on #12", "Pemeriksaan gagal pada #12"],
    ["Context 91% full, 182k of 200k tokens", "Konteks 91% penuh, 182k dari 200k token"],
    ["Out of Claude", "Claude habis"],
    ["resets in 2 h 5 min", "direset dalam 2 jam 5 mnt"],
    ["120 times the clock", "120 kali kecepatan jam"],
    [
      "3 agents have no desk on this floor. The list shows everyone.",
      "3 agen tidak punya meja di lantai ini. Daftar menampilkan semuanya.",
    ],
    ["Last answer 12 min ago: rain, 14°.", "Jawaban terakhir 12 mnt lalu: rain, 14°."],
    [
      "The writer could not start: no provider is ready",
      "Penulis tidak dapat dimulai: no provider is ready",
    ],
    [
      "Unable to clean up 1 of 3. The first reason: busy",
      "Tidak dapat membersihkan 1 dari 3. Alasan pertama: busy",
    ],
    ["Unable to save the Sound setting: refused", "Tidak dapat simpan pengaturan Suara: refused"],
    ["ended with an error (exit 2)", "berakhir dengan galat (exit 2)"],
    ["Add SHOP-12 to the lobby board", "Tambahkan SHOP-12 ke papan lobi"],
  ];
  for (const [english, indonesian] of lines) expect(translatePattern(english)).toBe(indonesian);
});
