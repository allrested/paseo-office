import { UI_ID } from "./ui-words-id.js";

/**
 * The interface's lines that are put together from data, in Indonesian: an age, a count, a name
 * with a few words around it. Each is the English line's shape and what it becomes; the parts
 * that are data are carried over as they are. A line that fits none stays English.
 *
 * A session's title, a chat message and a post are drawn through the same text, so a rule takes a
 * line only by words no title is likely to end in: none here matches "<anything> failed" or
 * "<anything> team".
 */
type Rule = readonly [RegExp, (...parts: string[]) => string];

/** A label as it reads after "Tidak dapat": its Indonesian, in lower case. */
const lower = (text: string) => {
  const label = translatePattern(`${text.charAt(0).toUpperCase()}${text.slice(1)}`);
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
};

/** A done task's "took 23 min · $0.42": the time through the duration rules, the cost as it is. */
const spent = (time: string, cost: string | undefined) => {
  const days = /^(\d+) d$/.exec(time)?.[1];
  let span = translatePattern(time);
  if (time === "under a minute") span = "kurang dari semenit";
  if (days !== undefined) span = `${days} hr`;
  const price = cost === "under $0.01" ? "kurang dari $0.01" : cost;
  return `memakan ${span}${price === undefined ? "" : ` · ${price}`}`;
};

export const RULES: readonly Rule[] = [
  [/^Put back (\d+) files?$/, (n) => `${n} berkas dikembalikan`],
  [
    /^(\d+) (changed since the turn|already as before the turn|outside the repository|inside \.git|ignored by git|left alone as links|in a linked folder|left alone as submodules|could not be written|not reached: git stopped|not reached: an agent began working|not put back yet: undo again to finish)$/,
    (n, why) => `${n} berkas ${translatePattern(why)}`,
  ],
  [/^(\d+) more$/, (n) => `${n} lagi`],
  [/^(\d\d:\d\d) · (\d+) files?$/, (time, n) => `${time} · ${n} berkas`],
  [/^(\d+) min ago$/, (n) => `${n} mnt lalu`],
  [/^(\d+) h ago$/, (n) => `${n} jam lalu`],
  [/^(\d+) min$/, (n) => `${n} mnt`],
  [/^(\d+) h$/, (n) => `${n} jam`],
  [/^(\d+) h (\d+) min$/, (h, m) => `${h} jam ${m} mnt`],
  [/^(\d+) d (\d+) h$/, (d, h) => `${d} hr ${h} jam`],
  [
    /^took (under a minute|\d+ min|\d+ h(?: \d+ min)?|\d+ d(?: \d+ h)?)(?: · (\$\d+\.\d\d|under \$0\.01))?$/,
    spent,
  ],
  [/^Idle for (.+)$/, (time) => `Menganggur selama ${translatePattern(time)}`],
  [/^Waiting (\d.*)$/, (time) => `Menunggu ${translatePattern(time)}`],
  [/^Waiting on (\d+) sub-agents?$/, (n) => `Menunggu ${n} sub-agen`],
  [/^Sub-agent of (.+)$/, (name) => `Sub-agen dari ${name}`],
  [/^Context (\d+)%$/, (n) => `Konteks ${n}%`],
  [/^context (\d+)%$/, (n) => `konteks ${n}%`],
  [/^Fullest context (\d+)%$/, (n) => `Konteks terpenuh ${n}%`],
  [/^(\d+) contexts nearly full$/, (n) => `${n} konteks hampir penuh`],
  [/^Memory (\d+)%$/, (n) => `Memori ${n}%`],
  [/^All sessions · (\d+)$/, (n) => `Semua sesi · ${n}`],
  // A kanban column's heading: its title, then how many it holds.
  [
    /^(Backlog|To do|In progress|Needs you|Waiting|Done|Notes) · (\d+)$/,
    (title, n) => `${translatePattern(title)} · ${n}`,
  ],
  [/^(\d+)\/(\d+) tasks$/, (done, all) => `${done}/${all} tugas`],
  [/^(\d+) open$/, (n) => `${n} terbuka`],
  [/^(\d+) open · a check failed$/, (n) => `${n} terbuka · satu pemeriksaan gagal`],
  [/^(.+) · (\d+) more open$/, (line, n) => `${line} · ${n} lagi terbuka`],
  [/^(\d+) agents?$/, (n) => `${n} agen`],
  [/^(\d+) members$/, (n) => `${n} anggota`],
  [/^(\d+) lines$/, (n) => `${n} baris`],
  [/^(\d+) problems$/, (n) => `${n} masalah`],
  [/^(\d+) waiting$/, (n) => `${n} menunggu`],
  [/^(\d+) running$/, (n) => `${n} berjalan`],
  [/^(\d+) failing$/, (n) => `${n} gagal`],
  [/^(\d+) claimed$/, (n) => `${n} diambil`],
  [/^(\d+) to review$/, (n) => `${n} untuk ditinjau`],
  [/^(\d+) needs? you$/, (n) => `${n} butuh Anda`],
  [/^(\d+) stalled$/, (n) => `${n} macet`],
  [/^(\d+) merged$/, (n) => `${n} digabung`],
  [
    /^(\d+ (?:needs? you|stalled|merged)(?: · \d+ (?:stalled|merged))+)$/,
    (parts) => parts.split(" · ").map(translatePattern).join(" · "),
  ],
  [
    /^(.+)'s pull request is merged(?:: (.+))?$/,
    (name, pullRequest) =>
      `Pull request milik ${name} telah digabung${pullRequest === undefined ? "" : `: ${pullRequest}`}`,
  ],
  [/^(\d+) tool steps$/, (n) => `${n} langkah alat`],
  [/^(\d+) cores?$/, (n) => `${n} inti`],
  [/^Task · claimed by (.+)$/, (name) => `Tugas · diambil oleh ${name}`],
  [/^Task · open$/, () => "Tugas · terbuka"],
  [/^Task · claimed$/, () => "Tugas · diambil"],
  [/^Task · done$/, () => "Tugas · selesai"],
  [/^claimed by (.+)$/, (name) => `diambil oleh ${name}`],
  [/^Done by (.+)$/, (name) => `Diselesaikan oleh ${name}`],
  [/^(.+) is stuck in a loop$/, (name) => `${name} terjebak dalam perulangan`],
  [/^(.+) stopped on an error$/, (name) => `${name} berhenti karena galat`],
  [/^(.+) is idle$/, (name) => `${name} menganggur`],
  [/^(.+) is at home$/, (name) => `${name} ada di rumah`],
  [/^(.+) waits for your answer$/, (name) => `${name} menunggu jawaban Anda`],
  [/^Needs permission: (.+)$/, (what) => `Butuh izin: ${what}`],
  [/^Replay · (.+)$/, (rest) => `Putar ulang · ${rest}`],
  [/^Yesterday (.+)$/, (time) => `Kemarin ${time}`],
  [/^Today's entry written at (.+)$/, (time) => `Catatan hari ini ditulis pukul ${time}`],
  [/^Agent ([0-9a-f]{8})$/, (id) => `Agen ${id}`],
  [/^Delete (\d+) finished to-dos\?$/, (n) => `Hapus ${n} tugas yang selesai?`],
  [/^Ask (\d+) agents for an update$/, (n) => `Minta kabar dari ${n} agen`],
  [/^Clean up all (\d+)$/, (n) => `Bersihkan semua ${n}`],
  [/^Show (\d+) skills$/, (n) => `Tampilkan ${n} skill`],
  [/^(.+) is typing…$/, (name) => `${name} sedang mengetik…`],
  [/^(.+) and (.+) are typing…$/, (a, b) => `${a} dan ${b} sedang mengetik…`],
  [/^(\d+) process(?:es)? · resident memory$/, (n) => `${n} proses · memori resident`],
  [/^([\d.]+ ?[KMGT]?B) free$/, (size) => `${size} kosong`],
  [/^(\d[\d hdmin]*) at work$/, (time) => `${translatePattern(time)} bekerja`],
  [/^(.+) does not report its context$/, (name) => `${name} tidak melaporkan konteksnya`],
  [
    /^(.+) has no mode "(.+)": the writer starts in (.+)\.$/,
    (provider, mode, used) =>
      `${provider} tidak punya mode "${mode}": penulis mulai dalam ${used}.`,
  ],
  [
    /^(.+) writes it and answers on the team's board\.$/,
    (name) => `${name} menulisnya dan menjawab di papan tim.`,
  ],
  [/^(\d+) agents? left something running$/, (n) => `${n} agen meninggalkan sesuatu yang berjalan`],
  [
    /^(\d+) skills? on this host, (\d+) in the teams' workspaces\.$/,
    (host, teams) => `${host} skill di host ini, ${teams} di workspace tim.`,
  ],
  [/^(\d+) lines, read at (.+)$/, (n, time) => `${n} baris, dibaca pukul ${time}`],
  [/^(.+); sub-agents: (.+)$/, (lead, subs) => `${lead}; sub-agen: ${subs}`],
  [/^(.+) agents are at a skill now\.$/, (who) => `${who} agen sedang memakai skill.`],
  [/^(.+) is at a skill now\.$/, (who) => `${who} sedang memakai skill.`],
  [
    /^(.+) connection from the host's environment; a saved one replaces it$/,
    (name) => `Koneksi ${name} dari environment host; koneksi tersimpan akan menggantikannya`,
  ],
  [/^(.+) connection saved on this host$/, (name) => `Koneksi ${name} tersimpan di host ini`],
  [/^No (.+) connection on this host$/, (name) => `Belum ada koneksi ${name} di host ini`],
  [
    /^(\d+) open, none waiting for a review$/,
    (n) => `${n} terbuka, tidak ada yang menunggu tinjauan`,
  ],
  [/^(\d+) open, (\d+) to review$/, (n, m) => `${n} terbuka, ${m} untuk ditinjau`],
  [/^(.+) has conflicts$/, (ref) => `${ref} memiliki konflik`],
  [
    /^(.+) is idle and gets the request on the team's board\.$/,
    (name) => `${name} sedang menganggur dan menerima permintaan di papan tim.`,
  ],
  [/^(.+): show less$/, (name) => `${name}: tampilkan lebih sedikit`],
  [/^(.+): show all of what it is for$/, (name) => `${name}: tampilkan seluruh kegunaannya`],
  [/^(.+) is still starting\.$/, (name) => `${name} masih memulai.`],
  [
    /^(.+): (.+) in the last 30 minutes$/,
    (title, range) => `${title}: ${range} dalam 30 menit terakhir`,
  ],
  [/^(\d+) people on the floor$/, (n) => `${n} orang di lantai`],
  [/^(\d+) times the clock$/, (n) => `${n} kali kecepatan jam`],
  [
    /^1 agent has no desk on this floor\. The list shows everyone\.$/,
    () => "1 agen tidak punya meja di lantai ini. Daftar menampilkan semuanya.",
  ],
  [
    /^(\d+) agents have no desk on this floor\. The list shows everyone\.$/,
    (n) => `${n} agen tidak punya meja di lantai ini. Daftar menampilkan semuanya.`,
  ],
  [
    /^1, 5 and 15 min · (\d+) CPUs available to Paseo$/,
    (n) => `1, 5, dan 15 mnt · ${n} CPU tersedia untuk Paseo`,
  ],
  [
    /^Asked (\d+) agents?\. Each answers on its team's board, and its note shows here\.$/,
    (n) =>
      `${n} agen ditanya. Masing-masing menjawab di papan timnya, dan catatannya tampil di sini.`,
  ],
  [/^Changes requested on (.+)$/, (ref) => `Perubahan diminta pada ${ref}`],
  [/^Checks fail on (.+)$/, (ref) => `Pemeriksaan gagal pada ${ref}`],
  [/^Context (\d+)% full, (.+)$/, (n, rest) => `Konteks ${n}% penuh, ${translatePattern(rest)}`],
  [/^(.+) of (.+) tokens$/, (used, max) => `${used} dari ${max} token`],
  [/^Details read at (.+)$/, (time) => `Detail dibaca pukul ${time}`],
  [
    /^Host resources\. Plan limit: (.+)$/,
    (plan) => `Sumber daya host. Batas paket: ${translatePattern(plan)}`,
  ],
  [
    /^Last answer (.+): (.+)\.$/,
    (age, what) => `Jawaban terakhir ${translatePattern(age)}: ${what}.`,
  ],
  [/^Log of (.+)$/, (name) => `Log ${name}`],
  [/^Needs you, (\d+)$/, (n) => `Butuh Anda, ${n}`],
  [/^Needs you: ([\s\S]+)$/, (reason) => `Butuh Anda: ${reason}`],
  // A blocked task on the Tasks card: its holder, then what it asked for.
  [/^(.+?) needs: ([\s\S]+)$/, (name, reason) => `${name} butuh: ${reason}`],
  [
    /^No idle agent, so nobody can be asked, in (.+)\.$/,
    (teams) => `Tidak ada agen yang menganggur, jadi tidak ada yang bisa diminta, di ${teams}.`,
  ],
  [/^No output yet, read at (.+)$/, (time) => `Belum ada keluaran, dibaca pukul ${time}`],
  [/^Out of ([A-Z][A-Za-z]+)$/, (name) => `${name} habis`],
  [
    /^(.+?) · (.+): at this pace out by (.+)$/,
    (note, name, time) => `${translatePattern(note)} · ${name}: dengan laju ini habis pada ${time}`,
  ],
  [
    /^(.+): at this pace out by (.+)$/,
    (name, time) => `${name}: dengan laju ini habis pada ${time}`,
  ],
  [/^Starting by itself: (.+)$/, (why) => `Memulai sendiri: ${translatePattern(why)}`],
  [
    /^waiting, (.+)'s (.+) is at (\d+)% \(starts under (\d+)%\)$/,
    (provider, window, used, under) =>
      `menunggu, ${window} milik ${provider} sudah ${used}% (mulai di bawah ${under}%)`,
  ],
  [
    /^waiting, a limit of the plan is too high \(starts under (\d+)%\)$/,
    (under) => `menunggu, batas paket terlalu tinggi (mulai di bawah ${under}%)`,
  ],
  [
    /^waiting, (\d+) tasks? (?:is|are) in progress or to do \(at most (\d+)\)$/,
    (n, most) =>
      `menunggu, ${n} tugas sedang dikerjakan atau akan dikerjakan (paling banyak ${most})`,
  ],
  [
    /^waiting, enough tasks are in progress or to do \(at most (\d+)\)$/,
    (most) =>
      `menunggu, terlalu banyak tugas sedang dikerjakan atau akan dikerjakan (paling banyak ${most})`,
  ],
  [
    /^done for today, (\d+) started \(at most (\d+) a day\)$/,
    (n, most) => `selesai untuk hari ini, ${n} dimulai (paling banyak ${most} sehari)`,
  ],
  [/^resets in (.+)$/, (time) => `direset dalam ${translatePattern(time)}`],
  [/^Owed from (.+?)\. (.+)$/, (day, state) => `Terutang sejak ${day}. ${translatePattern(state)}`],
  [/^The conversation cannot be read: (.+)$/, (why) => `Percakapan tidak dapat dibaca: ${why}`],
  [/^The report cannot be read: (.+)$/, (why) => `Laporan tidak dapat dibaca: ${why}`],
  [/^The vault cannot be searched: (.+)$/, (why) => `Brankas tidak dapat dicari: ${why}`],
  [/^The writer could not start: (.+)$/, (why) => `Penulis tidak dapat dimulai: ${why}`],
  [
    /^The writer's modes cannot be listed: (.+)$/,
    (why) => `Mode penulis tidak dapat didaftar: ${why}`,
  ],
  [/^The host has no folder for (.+)\.$/, (teams) => `Host tidak punya folder untuk ${teams}.`],
  [
    /^The newest (\d+), read at (.+)\. The terminal has (\d+) more above\.$/,
    (n, time, more) =>
      `${n} terbaru, dibaca pukul ${time}. Terminal punya ${more} lagi di atasnya.`,
  ],
  [/^This message has (\d+) tasks\.$/, (n) => `Pesan ini berisi ${n} tugas.`],
  [
    /^Unable to clean up (\d+) of (\d+)\. The first reason: (.+)$/,
    (failed, all, why) => `Tidak dapat membersihkan ${failed} dari ${all}. Alasan pertama: ${why}`,
  ],
  [/^What a skill of (.+) should teach$/, (team) => `Apa yang perlu diajarkan skill untuk ${team}`],
  [/^Workspace (.+) · Rename team$/, (name) => `Workspace ${name} · Ganti nama tim`],
  [/^Your answer to (.+)$/, (header) => `Jawaban Anda untuk ${header}`],
  [/^ended with an error \(exit (\d+)\)$/, (code) => `berakhir dengan galat (exit ${code})`],
  [/^from lobby task (.+)$/, (id) => `dari tugas lobi ${id}`],
  [/^on (.+)'s board$/, (name) => `di papan ${name}`],
  [/^Team (.+)$/, (name) => `Tim ${name}`],
  [/^for team (.+)$/, (name) => `untuk tim ${name}`],
  [/^(\d+) teammates?$/, (n) => `${n} anggota tim`],
  [
    /^(.+) text could not be loaded; the scene is in English$/,
    (language) => `Teks ${language} tidak dapat dimuat; adegan dalam bahasa Inggris`,
  ],
  [/^The host sent no (.+) text$/, (language) => `Host tidak mengirim teks ${language}`],
  [/^Started (.+)$/, (title) => `Memulai ${title}`],
  [/^Delete task: (.+)$/, (text) => `Hapus tugas: ${text}`],
  [/^Start task: (.+)$/, (text) => `Mulai tugas: ${text}`],
  [/^Follow-up: (.+)$/, (text) => `Tindak lanjut: ${text}`],
  [/^Waiting on (p\d+(?:, p\d+)*)$/, (ids) => `Menunggu ${ids}`],
  [/^After (p\d+(?:, p\d+)*)$/, (ids) => `Setelah ${ids}`],
  [/^Save the (.+) setting$/, (name) => `Simpan pengaturan ${translatePattern(name)}`],
  [/^Start an agent to analyze (.+)$/, (key) => `Mulai agen untuk menganalisis ${key}`],
  [/^Add (.+) to the lobby board$/, (key) => `Tambahkan ${key} ke papan lobi`],
  [/^Duty (\d+) time$/, (n) => `Waktu piket ${n}`],
  [
    /^For the 3D view\. Company floor has (\d+) desks, Cozy room (\d+), and Headquarters (\d+)\. Headquarters may draw more slowly on a phone\. Changing it starts the 3D view again\.$/,
    (pro, cozy, hq) =>
      `Untuk tampilan 3D. Lantai perusahaan punya ${pro} meja, Ruang nyaman ${cozy}, dan Kantor pusat ${hq}. Kantor pusat mungkin lebih lambat digambar di ponsel. Mengubahnya memulai ulang tampilan 3D.`,
  ],
  [
    /^Your notes on the 3D whiteboard, with ; between them\. Up to (\d+), (\d+) characters each\.$/,
    (most, each) =>
      `Catatan Anda di papan tulis 3D, dipisahkan dengan ;. Maksimal ${most}, masing-masing ${each} karakter.`,
  ],
  [
    /^An address that answers in open-meteo's shape, for example (\S+)\. https, or http on the host itself\. The host reads it every 15 minutes while an office is open\.$/,
    (example) =>
      `Alamat yang menjawab dalam format open-meteo, misalnya ${example}. https, atau http di host itu sendiri. Host membacanya tiap 15 menit selama kantor terbuka.`,
  ],
  // The intake's status line, and the chip that opens a task's ticket.
  [
    /^Last read (\d{2}:\d{2}): (\d+) imported$/,
    (time, n) => `Terakhir dibaca ${time}: ${n} diimpor`,
  ],
  [
    /^Last read (\d{2}:\d{2}): nothing new$/,
    (time) => `Terakhir dibaca ${time}: tidak ada yang baru`,
  ],
  [
    /^GitHub: last read (\d{2}:\d{2}): (\d+) imported$/,
    (time, n) => `GitHub: terakhir dibaca ${time}: ${n} diimpor`,
  ],
  [
    /^GitHub: last read (\d{2}:\d{2}): nothing new$/,
    (time) => `GitHub: terakhir dibaca ${time}: tidak ada yang baru`,
  ],
  [
    /^Line (\d+): "(.+)" is not owner\/repo$/,
    (n, entry) => `Baris ${n}: "${entry}" bukan owner/repo`,
  ],
  [/^Line (\d+): "(.+)" is there twice$/, (n, entry) => `Baris ${n}: "${entry}" muncul dua kali`],
  [
    /^(\S+): the first 20 matches are already imported: narrow the search$/,
    (repo) => `${repo}: 20 hasil pertama sudah diimpor: persempit pencarian`,
  ],
  [
    /^(\S+) is no longer read: not commented$/,
    (repo) => `${repo} tidak lagi dibaca: tidak dikomentari`,
  ],
  [/^Open (\S+) in Jira$/, (key) => `Buka ${key} di Jira`],
  [/^Open (\S+) on GitHub$/, (key) => `Buka ${key} di GitHub`],
  [
    /^Line (\d+): "(.+)" is not a Telegram user id$/,
    (n, entry) => `Baris ${n}: "${entry}" bukan ID pengguna Telegram`,
  ],
  [
    /^Connected as @(\S+)\. A message was sent to the chat\.$/,
    (bot) => `Terhubung sebagai @${bot}. Pesan telah dikirim ke chat.`,
  ],
  [/^Messages from others ignored: (\d+)$/, (n) => `Pesan dari orang lain diabaikan: ${n}`],
  // A failure reads "Unable to <the button>: <why>"; the why is the host's own, as it said it.
  [
    /^Unable to ([^:]+?)(?:: ([\s\S]*))?$/,
    (what, why) => `Tidak dapat ${lower(what)}${why === undefined ? "" : `: ${why}`}`,
  ],
];

/** The line in Indonesian when a rule fits it, else the line as it is. */
export function translatePattern(text: string): string {
  const known = UI_ID[text];
  if (known !== undefined) return known;
  for (const [shape, write] of RULES) {
    const match = shape.exec(text);
    if (match !== null) return write(...match.slice(1));
  }
  return text;
}
