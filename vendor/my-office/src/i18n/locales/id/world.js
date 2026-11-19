// The 3D world: text painted on screens, signs and plaques (drawn once when the scene is built, or redrawn on a timer),
// the backdrops, and the renderer's own messages.
export default {
  "noWebgl": "Peramban ini gagal mengaktifkan WebGL sehingga kantor 3D tidak dapat ditampilkan.",
  "softwareGl": "Peramban menampilkan gambar 3D tanpa GPU. Kantor berjalan dalam mode ringan.",
  "scene": {
    "city": "Kota",
    "country": "Pedesaan",
    "beach": "Pantai"
  },
  "cooler": "CPU {Mac}",
  "plaque": {
    "director": "DIREKTUR",
    "directorSub": "",
    "meeting": "RUANG RAPAT",
    "meetingSub": "",
    "library": "PERPUSTAKAAN",
    "librarySub": ""
  },
  "nameplate": "DIREKTUR",
  "slideSub": "Perkembangan minggu ini",
  "arcadeSoon": "SEGERA HADIR",
  "catSay": "meong~ ♥",
  "dev": {
    "title": {
      "other": "{label} · port {ports}"
    },
    "lost": {
      "other": "{n} server pengembangan masih menyala · klik untuk menghentikan"
    }
  },
  "tv": {
    "title": "RUANG SERVER",
    "working": "{n} bekerja",
    "waiting": "{n} menunggu",
    "resting": "{n} beristirahat",
    "today": "Hari ini: {prompts} · {cmds}",
    "prompts": {
      "other": "{n} prompt"
    },
    "cmds": {
      "other": "{n} perintah"
    },
    "plan": "Batas 5 jam: {pct}%",
    "pulse": "Aktivitas 30 menit terakhir"
  },
  "stairs": {
    "exit": "PINTU DARURAT",
    "exitSub": "TANGGA",
    "floor": "LANTAI",
    "plate": "TANGGA",
    "plateSub": "Lantai {n}"
  },
  "dept": {
    "free": "DEPARTEMEN {n}",
    "freeSub": "tersedia untuk proyek berikutnya",
    "name": "{name}",
    "sub": "Departemen {n}",
    "hq": "KANTOR PUSAT",
    "hqSub": "Departemen",
    "board": "Papan sprint",
    "cols": [
      "Belum dikerjakan",
      "Sedang dikerjakan",
      "Selesai"
    ]
  },
  "csgt": {
    "name": "Polisi lalu lintas",
    "chip": "CSGT",
    "chipIdle": "bertugas",
    "chipStop": "menghentikan pengendara",
    "chipCheck": "tes alkohol",
    "sign1": "CẢNH SÁT GIAO THÔNG",
    "sign2": "ĐANG LÀM NHIỆM VỤ",
    "chat": "Ada pemeriksaan polisi di depan kantor. Jangan lupa pakai helm waktu pulang 🪖",
    "chatAlc": "Malam ini ada tes alkohol di depan kantor. Habis minum? Pulang naik Ridely, ya 🍻🚫",
    "fp": "Amati polisi lalu lintas",
    "whereOn": "Pos pemeriksaan di depan kantor · {from}–{to}",
    "whereOff": "Berpatroli di sekitar kantor",
    "noStop": "Belum ada pengendara yang dihentikan. Petugas sedang mengamati lalu lintas.",
    "done": "selesai",
    "now": "berlangsung",
    "mr": "Bapak",
    "mrs": "Ibu",
    "anh": "Pak",
    "chi": "Bu",
    "lastPaper": "Berita acara terakhir:",
    "paperSoon": "Berita acara akan muncul di sini setelah ditulis petugas.",
    "clearText": "Tidak terdeteksi alkohol. Pengendara boleh lanjut tanpa dibuatkan berita acara.",
    "foot": "Sesuai Dekret 168/2024/NĐ-CP (berlaku sejak 1 Januari 2025) dan Surat Edaran 73/2024/TT-BCA. Besar denda ditetapkan dalam keputusan sanksi sesuai rentang di atas.",
    "mock": "Contoh dokumen dalam My Office. Nama, pelat nomor, dan nomor berita acara hanyalah rekaan.",
    "short": {
      "helmet": "Tanpa helm",
      "three": "Membonceng dua penumpang (bertiga di motor)",
      "phone": "Menggunakan ponsel saat berkendara",
      "red": "Menerobos lampu merah",
      "alc1": "Alkohol, tingkat 1",
      "alc2": "Alkohol, tingkat 2",
      "alc3": "Alkohol, tingkat 3",
      "clear": "Tes alkohol: tidak ada pelanggaran"
    },
    "act": {
      "helmet": "mengendarai sepeda motor di jalan tanpa mengenakan helm",
      "three": "membonceng dua penumpang",
      "phone": "memegang dan menggunakan ponsel saat berkendara di jalan",
      "red": "tidak mematuhi lampu lalu lintas",
      "alc1": "berkendara dengan kadar alkohol dalam napas hingga 0,25 mg per liter",
      "alc2": "berkendara dengan kadar alkohol dalam napas di atas 0,25 hingga 0,4 mg per liter",
      "alc3": "berkendara dengan kadar alkohol dalam napas di atas 0,4 mg per liter",
      "clear": "tidak ada pelanggaran"
    },
    "step": {
      "signal": "Beri isyarat untuk menepi (peluit, tongkat)",
      "salute": "Beri hormat sesuai peraturan kepolisian",
      "reason": "Jelaskan alasan pemeriksaan",
      "papers": "Periksa surat izin mengemudi dan surat kendaraan di VNeID",
      "blow": "Tes alkohol melalui napas",
      "write": "Buat berita acara pelanggaran",
      "sign": "Pengendara menandatangani berita acara",
      "go": "Pemeriksaan selesai"
    },
    "law": {
      "basis": "Dasar hukum",
      "basisText": "{law}, Dekret 168/2024/NĐ-CP",
      "fine": "Kisaran denda",
      "fineText": "{a}–{b} đồng",
      "points": "Surat izin mengemudi",
      "pts": "dikurangi {n} poin",
      "noPts": "tanpa pengurangan poin",
      "strip": "dibekukan selama {a}–{b} bulan",
      "held": "Kendaraan",
      "heldText": "dapat ditahan hingga 7 hari sebelum keputusan sanksi terbit",
      "pay": "Pembayaran",
      "payText": "dalam 10 hari sejak keputusan sanksi terbit, melalui Portal Layanan Publik Nasional (VNeID), bank, atau kantor perbendaharaan"
    },
    "say": {
      "stop": "Silakan menepi!",
      "greet": "Selamat siang.",
      "reason": {
        "helmet": "Anda berkendara tanpa helm.",
        "three": "Anda membonceng dua penumpang. Itu tidak diperbolehkan.",
        "phone": "Anda menggunakan ponsel saat berkendara.",
        "red": "Anda menerobos lampu merah di persimpangan.",
        "alc": "Kami sedang melakukan pemeriksaan alkohol terjadwal. Terima kasih atas kerja samanya."
      },
      "papers": "Mohon tunjukkan surat izin mengemudi dan surat kendaraan Anda.",
      "show": "Ini suratnya, di VNeID.",
      "blow": "Silakan tiup alat tes ini.",
      "clear": "Kadar alkohol nol. Terima kasih atas kerja samanya, hati-hati di jalan.",
      "positive": "Hasil tes menunjukkan {mg} mg alkohol per liter napas.",
      "write": "Kami akan membuat berita acara pelanggaran.",
      "sign": "Silakan baca dan tanda tangani di sini.",
      "ok": "Saya mengerti dan menerima.",
      "pay": "Setelah keputusan terbit, silakan bayar denda secara daring atau melalui bank dalam 10 hari.",
      "held": "Sesuai ketentuan, kendaraan kami tahan. Anda dapat mengambilnya setelah keputusan terbit.",
      "bye": "Terima kasih atas kerja samanya."
    },
    "paper": {
      "unit": "KEPOLISIAN KOTA",
      "team": "SATUAN POLISI LALU LINTAS",
      "no": "Nomor: {no}/BB-VPHC",
      "nation": "REPUBLIK SOSIALIS VIETNAM",
      "motto": "Kemerdekaan - Kebebasan - Kebahagiaan",
      "placeDate": "{d}/{m}/{y}",
      "title": "BERITA ACARA PELANGGARAN ADMINISTRATIF",
      "sub": "Ketertiban dan keselamatan lalu lintas jalan",
      "when": "Pada hari ini, tanggal {d}/{mo}/{y}, pukul {h}:{m}, bertempat {place}.",
      "place": "di depan gedung My Office",
      "by": "Dibuat oleh: {rank} {name}, petugas polisi lalu lintas.",
      "to": "Terhadap: {title} {name}, lahir {born}.",
      "vehicle": "Kendaraan: sepeda motor, pelat nomor {plate}.",
      "did": "Pelanggaran: {act}.",
      "mg": " (hasil tes: {mg} mg per liter napas)",
      "law": "Berdasarkan {law} dalam Dekret 168/2024/NĐ-CP tanggal 26 Desember 2024.",
      "measure": "Tindakan pencegahan: {measure}.",
      "held": "kendaraan ditahan",
      "none": "tidak ada",
      "says": "Pernyataan yang bersangkutan: {says}.",
      "accept": "menerima",
      "copies": "Berita acara diselesaikan pukul {h}:{m} pada hari yang sama dalam dua rangkap yang berkekuatan setara, lalu dibacakan kepada yang bersangkutan. Satu rangkap diserahkan kepadanya.",
      "signer": "YANG BERSANGKUTAN",
      "writer": "PETUGAS PENCATAT",
      "signNote": "(Tanda tangan dan nama lengkap)"
    }
  },
  "nhau": {
    "name": "Kedai minum pinggir jalan Ba Khía",
    "short": "Ba Khía",
    "chip": "Quán nhậu",
    "chipOpen": "{n} orang di meja",
    "chipOffice": "{n} orang di meja · {m} dari kantor",
    "sign0": "QUÁN NHẬU",
    "sign1": "BA KHÍA",
    "sign2": "Lẩu · Nướng · Ốc · Bia lạnh",
    "subOpen": "Buka · {a}–{b}",
    "subShut": "Tutup · buka pukul {a}–{b}",
    "fp": "Duduk sambil minum es teh",
    "fpDone": "Es teh, 3.000 đồng. Sambil lihat orang lalu-lalang 🍵",
    "fpJoin": "Gabung di meja teman kantor",
    "fpJoinDone": "Satu meja langsung berdiri: “Ada bos! Dô!” Ini es teh buat kamu 🍵",
    "say": {
      "go": "Waktunya minum bir! 🍻",
      "sit": "Tolong tambah es dan handuk dingin, ya!",
      "mot": "Một, hai, ba…",
      "do": "Dô!",
      "work": "Ada kerjaan, aku naik dulu 🏃",
      "noDrive": "Habis minum jangan berkendara, ya!",
      "leaveBike": "Motorku kutinggal dulu, besok kuambil.",
      "boss": "Bos datang! Dô! 🍻",
      "leave": "Aku pulang dulu, mau bayar!"
    },
    "chat": {
      "invite": "Nanti malam mau minum bir bareng? 🍻",
      "yes": [
        "Aku ikut!",
        "Hitung aku juga 🙋",
        "Sisakan kursi buat aku, ya",
        "Oke, di kedai Ba Khía"
      ],
      "cheers": "Một hai ba dô 🍻",
      "noDrive": "Kalau habis minum, jangan bawa kendaraan 🚕",
      "ridely": "Ridely sudah di jalan"
    },
    "where": {
      "coming": "Berangkat ke {name}",
      "sit": {
        "other": "Di {name} · {n} putaran minum"
      },
      "work": "Kembali ke kantor dari kedai",
      "home": "Pulang naik {how}"
    },
    "how": {
      "ridely": "Ridely Bike",
      "aqua": "Aqua Ride Bike",
      "taxi": "taksi Aqua Ride",
      "bike": "skuter"
    },
    "card": {
      "office": "Meja teman kantor",
      "noOffice": "Belum ada teman kantor yang datang malam ini.",
      "rounds": {
        "other": "{n} putaran minum"
      },
      "locals": "Pelanggan tetap di meja lain: {n}",
      "menu": "Menu",
      "foot": "Contoh harga kedai pinggir jalan di Kota Ho Chi Minh. Jangan berkendara setelah minum alkohol.",
      "stage": {
        "coming": "sedang menuju kedai",
        "sit": {
          "other": "{n} putaran minum"
        },
        "work": "kembali bekerja",
        "home": "sudah pulang naik angkutan"
      }
    },
    "menu": {
      "beer": "Bir kaleng dengan es",
      "towel": "Handuk dingin",
      "peanut": "Kacang panggang",
      "squid": "Cumi kering bakar",
      "snail": "Siput laut dengan mentega bawang putih",
      "clam": "Kerang kukus serai",
      "salad": "Salad ayam dan kol",
      "wings": "Sayap ayam saus ikan",
      "greens": "Tumis kangkung bawang putih",
      "hotpot": "Hotpot hidangan laut ala Thailand",
      "tea": "Es teh"
    }
  },
  "microwave": {
    "note1": "BUKA TUTUP WADAHNYA!",
    "note2": "Lap setelah dipakai",
    "note3": "Ikan dan mắm secukupnya, ya 🙏"
  }
};
