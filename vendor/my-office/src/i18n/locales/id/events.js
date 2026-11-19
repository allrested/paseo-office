// How events read on screen (ui/event-text.js): the lines in the feed and the session drawer, the speech bubbles over the
// characters, and the safe words streamer mode shows in place of paths, commands and prompts. Bubbles sit over people's
// heads, so keep them short.
export default {
  "status": {
    "work": "bekerja",
    "wait": "perlu persetujuan",
    "rest": "beristirahat"
  },
  "station": {
    "dining": "ruang makan",
    "board": "papan tulis",
    "library": "perpustakaan",
    "desk": "meja kerja",
    "server": "ruang server",
    "globe": "jendela",
    "coffee": "pojok kopi",
    "meeting": "ruang rapat",
    "director": "ruang direktur",
    "wc": "toilet",
    "tests": "papan pengujian",
    "post": "kotak pos"
  },
  "generic": {
    "prompt": "tugas baru",
    "read": "sebuah berkas",
    "grep": "sesuatu",
    "glob": "sebuah folder",
    "skill": "sebuah skill",
    "edit": "sebuah berkas",
    "write": "sebuah berkas",
    "bash": "menjalankan perintah",
    "web": "sesuatu",
    "fetch": "halaman web",
    "mcp": "sebuah alat",
    "wait": "sebuah tindakan",
    "fail": "sebuah tindakan",
    "deploy": "versi baru",
    "test": "pengujian"
  },
  "verb": {
    "prompt": "tugas baru: “{label}”",
    "read": "membaca {label}",
    "grep": "mencari “{label}”",
    "glob": "menampilkan daftar berkas {label}",
    "skill": "membuka {label}",
    "edit": "menyunting {label}",
    "write": "menulis {label}",
    "plan": "memperbarui {label}",
    "web": "mencari “{label}” di web",
    "fetch": "mengambil {label}",
    "mcp": "menggunakan {label}",
    "agent": "memulai subagen {label}",
    "agentDesc": "memulai subagen {label}: {desc}",
    "compact": "meringkas percakapan",
    "ask": "punya pertanyaan untukmu",
    "wait": "menunggu persetujuanmu: {label}",
    "fail": "kesalahan: {label}",
    "stopNamed": "selesai: “{label}”",
    "stop": "selesai, waktunya menyeduh kopi",
    "interrupt": "berhenti di tengah jalan (kamu menekan Esc)",
    "idle": "menunggu pesanmu",
    "deploy": "melakukan deploy {label} 🚀",
    "commit": "membuat commit: “{label}” 🖨️",
    "commitHidden": "membuat commit 🖨️",
    "push": "mengirim kode ke {target} 🚀",
    "release": "merilis {tag} 🏷️",
    "ciRed": "CI merah: {label}",
    "ciRedDefault": "pengujian gagal",
    "ciGreen": "CI kembali hijau: {label}",
    "ciGreenDefault": "pengujian lulus",
    "start": "sesi dibuka",
    "end": "sesi ditutup",
    "substart": "subagen {label} masuk ke ruang rapat",
    "substop": "subagen {label} kembali melapor",
    "test": "menjalankan pengujian: {label} 🧪",
    "testok": "pengujian lulus ✅ ({label})",
    "testfail": "pengujian gagal ❌ ({label})",
    "use": "menggunakan {label}"
  },
  "bubble": {
    "wait": "Perlu persetujuan: {label}",
    "ask": "Ada pertanyaan buat kamu",
    "fail": "Ada kesalahan: {label}",
    "stop": "Sudah beres",
    "interrupt": "Sudah kuhentikan sesuai permintaanmu",
    "idle": "Lagi nunggu kamu",
    "compact": "Lagi meringkas riwayat",
    "agent": "Kuserahkan ke {label}",
    "deploy": "Lagi deploy {label}",
    "plan": "Lagi memperbarui daftar tugas",
    "testok": [
      "Hijau semua! ✅",
      "Tesnya lulus 🎉",
      "Nggak ada yang gagal!"
    ],
    "testfail": [
      "Merah. Coba kulihat…",
      "Ada satu tes gagal, aku cek",
      "Lho, kok merah 🤔"
    ]
  }
};
