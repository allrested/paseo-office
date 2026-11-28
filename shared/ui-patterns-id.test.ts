import { expect, test } from "vitest";
import { translatePattern } from "./ui-patterns-id.js";

test("lines built from data keep their data and take Indonesian words", () => {
  const lines: [string, string][] = [
    ["12 min ago", "12 mnt lalu"],
    [
      "acme/web: the first 20 matches are already imported: narrow the search",
      "acme/web: 20 hasil pertama sudah diimpor: persempit pencarian",
    ],
    ["acme/web is no longer read: not commented", "acme/web tidak lagi dibaca: tidak dikomentari"],
    ["GitHub: last read 12:40: 2 imported", "GitHub: terakhir dibaca 12:40: 2 diimpor"],
    ['Line 2: "-evil/x" is not owner/repo', 'Baris 2: "-evil/x" bukan owner/repo'],
    ['Line 2: "0123" is not a Telegram user id', 'Baris 2: "0123" bukan ID pengguna Telegram'],
    [
      "Connected as @office_bot. A message was sent to the chat.",
      "Terhubung sebagai @office_bot. Pesan telah dikirim ke chat.",
    ],
    ["Messages from others ignored: 3", "Pesan dari orang lain diabaikan: 3"],
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
    ["Backlog · 3", "Antrean · 3"],
    ["Start task: Build the API", "Mulai tugas: Build the API"],
    ["1 needs you", "1 butuh Anda"],
    ["2 need you · 1 stalled", "2 butuh Anda · 1 macet"],
    ["Builder is idle", "Builder menganggur"],
    ["Builder is at home", "Builder ada di rumah"],
    ["1 merged", "1 digabung"],
    ["1 needs you · 1 stalled · 2 merged", "1 butuh Anda · 1 macet · 2 digabung"],
    ["1 stalled · 1 merged", "1 macet · 1 digabung"],
    ["Builder's pull request is merged", "Pull request milik Builder telah digabung"],
    [
      "Builder's pull request is merged: #42 Fix the ledger total",
      "Pull request milik Builder telah digabung: #42 Fix the ledger total",
    ],
    ["3 need you", "3 butuh Anda"],
    ["Needs you: Which region?", "Butuh Anda: Which region?"],
    ["Builder needs: Which region?", "Builder butuh: Which region?"],
    ["3/7 tasks", "3/7 tugas"],
    ["2 open · a check failed", "2 terbuka · satu pemeriksaan gagal"],
    ["Jira SHOP-12: Checkout fails · 2 more open", "Jira SHOP-12: Checkout fails · 2 lagi terbuka"],
    ["Checkout is stuck in a loop", "Checkout terjebak dalam perulangan"],
    ["Task · claimed by Builder", "Tugas · diambil oleh Builder"],
    ["Team QA-PR", "Tim QA-PR"],
    ["for team QA-PR", "untuk tim QA-PR"],
    ["1 teammate", "1 anggota tim"],
    ["2 teammates", "2 anggota tim"],
    ["Replay · 14:05 · 60×", "Putar ulang · 14:05 · 60×"],
    ["3 h 20 min at work", "3 jam 20 mnt bekerja"],
    ["1.5 GB free", "1.5 GB kosong"],
    ["Put back 1 file", "1 berkas dikembalikan"],
    ["3 changed since the turn", "3 berkas diubah sejak giliran itu"],
    ["1 ignored by git", "1 berkas diabaikan git"],
    ["8 more", "8 lagi"],
    ["13:40 · 5 files", "13:40 · 5 berkas"],
    ["Last read 12:40: 3 imported", "Terakhir dibaca 12:40: 3 diimpor"],
    ["Last read 12:40: nothing new", "Terakhir dibaca 12:40: tidak ada yang baru"],
    ["Open PROJ-12 in Jira", "Buka PROJ-12 di Jira"],
    ["Open acme/x#4 on GitHub", "Buka acme/x#4 di GitHub"],
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
    [
      "Claude 85% · Codex week: at this pace out by Thu 14:00",
      "Claude 85% · Codex week: dengan laju ini habis pada Thu 14:00",
    ],
    [
      "Claude 5 hours: at this pace out by Thu 14:00",
      "Claude 5 hours: dengan laju ini habis pada Thu 14:00",
    ],
    [
      "Host resources. Plan limit: Claude 5 hours: at this pace out by Thu 14:00",
      "Sumber daya host. Batas paket: Claude 5 hours: dengan laju ini habis pada Thu 14:00",
    ],
    ["Starting by itself", "Memulai sendiri"],
    [
      "Starting by itself: nothing here is ready to start",
      "Memulai sendiri: belum ada yang siap dimulai di sini",
    ],
    [
      "Starting by itself: waiting, Claude's 5 hours is at 82% (starts under 70%)",
      "Memulai sendiri: menunggu, 5 hours milik Claude sudah 82% (mulai di bawah 70%)",
    ],
    [
      "Starting by itself: waiting, 3 tasks are in progress or to do (at most 3)",
      "Memulai sendiri: menunggu, 3 tugas sedang dikerjakan atau akan dikerjakan (paling banyak 3)",
    ],
    [
      "Starting by itself: done for today, 10 started (at most 10 a day)",
      "Memulai sendiri: selesai untuk hari ini, 10 dimulai (paling banyak 10 sehari)",
    ],
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
    ["Duty 2 time", "Waktu piket 2"],
  ];
  for (const [english, indonesian] of lines) expect(translatePattern(english)).toBe(indonesian);
});

test("a done task's time and cost line takes the language, its dollar amount as it is", () => {
  const lines: [string, string][] = [
    ["took 23 min · $0.42", "memakan 23 mnt · $0.42"],
    ["took 1 h 5 min", "memakan 1 jam 5 mnt"],
    ["took 2 d", "memakan 2 hr"],
    ["took 1 d 3 h · $12.50", "memakan 1 hr 3 jam · $12.50"],
    ["took under a minute · under $0.01", "memakan kurang dari semenit · kurang dari $0.01"],
  ];
  for (const [english, there] of lines) expect(translatePattern(english)).toBe(there);
  // Only the exact line: a post that starts with the word is left alone.
  expect(translatePattern("took the bus to work")).toBe("took the bus to work");
});
