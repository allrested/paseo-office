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

/** A word or a phrase by its entry in the dictionary, else as it is. */
const word = (text: string) => UI_ID[text] ?? text;
/** A label as it reads after "Tidak dapat": its Indonesian, in lower case. */
const lower = (text: string) => {
  const label = word(`${text.charAt(0).toUpperCase()}${text.slice(1)}`);
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
};

const RULES: readonly Rule[] = [
  [/^(\d+) min ago$/, (n) => `${n} mnt lalu`],
  [/^(\d+) h ago$/, (n) => `${n} jam lalu`],
  [/^(\d+) min$/, (n) => `${n} mnt`],
  [/^(\d+) h$/, (n) => `${n} jam`],
  [/^(\d+) h (\d+) min$/, (h, m) => `${h} jam ${m} mnt`],
  [/^(\d+) d (\d+) h$/, (d, h) => `${d} hr ${h} jam`],
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
