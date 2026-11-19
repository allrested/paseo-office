// Places: the chips over the furniture (interact/place-chips.js) and the cards they open (interact/place-cards.js).
export default {
  "chip": {
    "director": "Ruang direktur",
    "meeting": "Ruang rapat",
    "libraryPro": "Perpustakaan · pencarian",
    "library": "Perpustakaan",
    "window": "Jendela · pencarian web",
    "dining": "Ruang makan",
    "lounge": "Ruang santai",
    "deploy": "Landasan peluncuran",
    "serverPro": "Ruang server",
    "server": "Ruang server",
    "lobby": "Lobi · lift",
    "wc": "Toilet",
    "board": "Papan tulis",
    "devTeam": "Tim pengembang",
    "printer": "Printer",
    "door": "Pintu masuk",
    "coffee": "Pojok kopi",
    "desks": "Meja kerja"
  },
  "live": {
    "reading": "{n} sedang membaca",
    "searching": "{n} sedang mencari",
    "deployToday": "{n} hari ini",
    "tasks": {
      "other": "{n} tugas"
    },
    "resting": "{n} sedang beristirahat",
    "desks": "{used}/{total} meja",
    "subagents": {
      "other": "{n} subagen"
    },
    "delivering": "mengantar prompt",
    "queued": {
      "other": "{n} prompt menunggu diantar"
    },
    "people": {
      "other": "{n} orang"
    }
  },
  "trophy": {
    "tier1": "Perunggu",
    "tier2": "Perak",
    "tier3": "Emas",
    "keepsake": "Kenang-kenangan",
    "cup": "Piala {tier}",
    "progress": "Sudah {have} · kurang {left} lagi",
    "shelf": {
      "other": "Rak piala · {n} piala"
    },
    "none": "Belum ada piala.",
    "next": "Target berikutnya",
    "counting": "Menghitung riwayat Claude Code di komputer ini…"
  },
  "library": {
    "title": "Perpustakaan",
    "sub": "Agen datang ke sini untuk membaca berkas, mencari kode, dan membuka skill",
    "now": "sedang membaca",
    "recent": "Baru dibaca",
    "empty": "Belum ada agen yang membaca berkas sejak kantor dibuka.",
    "today": {
      "other": "Hari ini: {n} kali membaca"
    }
  },
  "window": {
    "title": "Jendela · pencarian web",
    "sub": "Pencarian web, pembacaan halaman, dan alat MCP",
    "now": "sedang mencari",
    "recent": "Baru dicari",
    "empty": "Belum ada yang mencari di web hari ini.",
    "today": {
      "other": "Hari ini: {n} pencarian web"
    }
  },
  "deploy": {
    "title": "Landasan peluncuran · Git",
    "sub": "Setiap commit membuat printer mencetak, setiap push meluncurkan roket. Kalau CI gagal, lampu rak server menyala merah. Makin berantakan mejanya, makin banyak berkas yang belum masuk commit.",
    "ciRed": "CI gagal",
    "ciRunning": "CI berjalan",
    "ciGreen": "CI lulus",
    "dirty": {
      "other": "{n} berkas belum masuk commit"
    },
    "clean": "semua sudah masuk commit",
    "ahead": {
      "other": "{n} commit belum di-push"
    },
    "aRepo": "sebuah repositori",
    "git": "Git dan CI",
    "recent": "Aktivitas terbaru",
    "empty": "Belum ada commit, push, atau deployment sejak kantor dibuka.",
    "today": {
      "other": "Hari ini: {n} deployment"
    },
    "test": "Uji peluncuran"
  },
  "door": {
    "title": "Pintu masuk",
    "titleLift": "Lift",
    "sub": "Setiap sesi baru masuk lewat pintu ini dan keluar saat ditutup",
    "subLift": "Sesi baru naik lift. Saat ditutup, sesi memakai jaket, menyandang ransel, lalu turun dengan lift",
    "subService": "Lift diservis beberapa menit setelah kantor dimulai ulang. Semua lewat tangga di sebelahnya",
    "came": "{name} masuk",
    "went": "{name} pulang",
    "empty": "Belum ada yang datang atau pergi sejak kantor dibuka.",
    "open": {
      "other": "{n} sesi terbuka"
    }
  },
  "coffee": {
    "title": "Pojok kopi",
    "sub": "Sesi yang selesai beristirahat di sini sampai kamu mengirim pesan lagi",
    "done": "Selesai: “{prompt}” · {ago}",
    "noPrompt": "Belum ada prompt",
    "hint": "Klik seseorang untuk memberikan prompt berikutnya",
    "busy": "Semua sedang sibuk",
    "brew": "Seduh kopi",
    "empty": "Tidak ada yang sedang beristirahat."
  },
  "meeting": {
    "title": "Ruang rapat",
    "sub": "Saat Claude memberikan tugas ke subagen, subagen mengikuti rapat di sini",
    "steps": {
      "other": "dari {name} · {n} langkah"
    },
    "doneAt": "dari {name} · selesai {time}",
    "empty": "Tidak ada subagen yang sedang rapat.",
    "recent": "Baru selesai"
  },
  "desks": {
    "title": "Meja kerja",
    "sub": "Setiap sesi mendapat satu meja. Kalau sedang mengetik, berarti ada berkas yang sedang disunting",
    "row": "Meja {n} · {name}",
    "waiting": "Menunggu persetujuanmu",
    "resting": "Beristirahat · selesai “{prompt}”",
    "noPrompt": "Belum ada prompt",
    "empty": "Belum ada yang duduk di meja.",
    "recent": "Baru disunting",
    "free": {
      "other": "{n} meja kosong"
    },
    "edits": {
      "other": "{n} suntingan berkas hari ini"
    }
  },
  "printer": {
    "title": "Printer",
    "sub": "Pekerjaan yang baru selesai",
    "turnDone": "Satu giliran selesai",
    "hint": "Setiap giliran yang selesai menghasilkan satu halaman cetak",
    "reprint": "Cetak lagi",
    "empty": "Belum ada yang dicetak."
  },
  "director": {
    "title": "Ruang direktur",
    "sub": "Kamulah direkturnya. Setiap prompt yang kamu kirim diantar ke meja, dan siapa pun yang sudah selesai datang ke sini untuk melapor",
    "carrying": "Mengantar prompt ke {name}",
    "queued": "Menunggu giliran untuk menemui {name}",
    "aSession": "sebuah sesi",
    "empty": "Direktur sedang di meja. Kirim prompt ke salah satu sesi dan direktur akan mengantarnya ke meja sesi itu.",
    "recent": "Prompt yang baru dikirim",
    "since": "Sejak kantor dibuka: {given} · {reports}",
    "given": {
      "other": "{n} prompt dikirim"
    },
    "reports": {
      "other": "{n} laporan diterima"
    }
  },
  "wc": {
    "title": "Toilet",
    "sub": "Sesekali ada yang mampir sebelum istirahat",
    "stall": "Di dalam bilik, pintu tertutup",
    "washing": "Mencuci tangan",
    "empty": "Tidak ada orang di dalam."
  },
  "lounge": {
    "title": "Ruang santai",
    "sub": "Ada sofa, akuarium, mesin arkade, sepak bola meja, dan landasan peluncuran. Yang sudah selesai bekerja duduk di sini",
    "feed": "Beri makan ikan",
    "coin": "Masukkan koin ke mesin arkade",
    "cat": "Panggil kucing ke sofa",
    "rocket": "Luncurkan roket",
    "done": "Selesai “{prompt}”",
    "noPrompt": "Belum ada prompt",
    "empty": "Belum ada yang beristirahat."
  }
};
