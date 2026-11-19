// PASEO: names of real shops, apps and products are made-up ones (scripts/genericise-street.mjs).
export default {
  language: 'Bahasa',
  switchingLang: 'Mengganti bahasa…',
  toPro: 'Membangun kantor perusahaan…',
  toHq: 'Membangun kantor pusat…',
  toCozy: 'Kembali ke kantor mungil…',
  seasonOn: 'Memasang dekorasi musiman…',
  seasonOff: 'Melepas dekorasi musiman…',
  graphics: 'Grafis',
  q: { auto: 'Otomatis', low: 'Rendah', medium: 'Sedang', high: 'Tinggi' },
  qNow: 'Saat ini: {level}. Turunkan jika kantor terasa lambat atau kipas berputar kencang.',
  qDropped: 'Kantor terasa lambat, jadi kualitas grafis diturunkan ke {level}. Ubah di Pengaturan → Grafis.',
  tabs: { office: 'Kantor', people: 'Karakter', display: 'Tampilan', more: 'Lainnya' },
  layouts: {
    cozy: { name: 'Mungil', sub: 'Satu ruang terbuka · 9 meja' },
    pro: { name: 'Perusahaan', sub: 'Satu lantai penuh · 12 meja' },
    hq: { name: 'Kantor pusat', sub: 'Empat departemen · 44 meja' },
  },
  layoutNote: 'Saat denah berubah, kantor dibangun ulang. Halaman akan dimuat ulang dan sesimu langsung muncul kembali.',
  times: {
    auto: { name: 'Otomatis', sub: 'Mengikuti jam' },
    day: { name: 'Siang', sub: 'Selalu terang' },
    night: { name: 'Malam', sub: 'Lampu kantor dan kota' },
  },
  looks: {
    toy: { sub: 'Bulat dan mengilap seperti figur vinil' },
    cartoon: { sub: 'Mata besar dan rambut berlapis seperti di film animasi' },
  },
  lookNote: 'Semua orang di kantor berubah sekaligus, termasuk karaktermu dalam mode Jalan-jalan.',
  qSub: { auto: 'Turun jika lambat', low: 'Ringan, hemat baterai', medium: 'Seimbang', high: 'Paling tajam, bayangan lembut' },
  weatherOff: 'Nonaktif',
  notify: 'Ponsel dan peringatan',
  behaviour: 'Perilaku',
  // Settings → More: the models of a session and its subagents (ui/models.js, server/models.mjs)
  models: {
    title: 'Model untuk koordinator dan subagen',
    note: 'Tugas besar bisa dibagi ke beberapa subagen. Sesi memakai satu model untuk berkoordinasi dan subagen bekerja dengan model lain (Sonnet lebih murah daripada Opus). Berlaku untuk sesi Claude yang dimulai setelah ini di semua akun.',
    main: 'Sesi (koordinator)', sub: 'Subagen',
    opt: { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', default: 'Bawaan', same: 'Sama' },
    force: 'Selalu gunakan model ini untuk subagen (meski Claude memilih model lain)',
    split: 'Minta Claude membagi tugas besar ke beberapa subagen',
    splitNote: 'Catatan singkat ditambahkan ke ~/.claude/CLAUDE.md dan dihapus saat opsi ini dinonaktifkan.',
    other: 'Saat ini: {model} (diatur manual)',
    saved: 'Tersimpan. Sesi Claude yang dimulai setelah ini akan memakai model tersebut. Sesi yang sudah terbuka tetap memakai model sebelumnya.',
    readOnly: 'Berkas ~/.claude/settings.json tidak bisa dibaca di sini (mungkin berisi komentar). Atur model secara manual di berkas itu.',
  },
  // Settings → More: the stuck-loop breaker (server/loops.mjs)
  // Settings → More: approve right from the Mac's notifications (ui/mac-approve.js, server/mac-hold.mjs)
  macApprove: {
    title: 'Beri persetujuan dari notifikasi Mac',
    on: 'Beri persetujuan dari notifikasi Mac',
    note: 'Saat kamu memakai Mac (baru menekan tombol atau menggerakkan tetikus) dan ikon di bar menu aktif, permintaan Claude menunggu hingga 20 detik supaya kamu bisa memilih Izinkan atau Tolak di notifikasi. Untuk perintah berisiko, hanya ada pilihan Tolak. Saat opsi ini mati atau kamu sedang pergi, Claude langsung bertanya di IDE seperti biasa.',
  },
  loop: {
    title: 'Percobaan yang terus berulang',
    on: 'Hentikan percobaan yang terus berulang',
    note: 'Jika sesi terus melakukan hal yang sama dan mendapat galat yang sama, percobaan berikutnya diblokir dan Claude diminta mencoba cara lain. Lewat kartu di obrolan, kamu bisa menghentikannya atau mengirim petunjuk. Kamu juga akan diberi tahu jika percakapan berulang kali dipadatkan atau biaya terus bertambah tanpa ada berkas yang diedit.',
    after: 'Blokir setelah', tries: { other: '{n} kegagalan' },
    costAfter: 'Biaya terus bertambah tanpa ada berkas yang diedit selama', mins: '{n} mnt',
    install: 'Jalankan `node bin/cli.mjs install` sekali lagi agar Claude Code memeriksa dengan kantor sebelum setiap langkah.',
  },
  // Settings → More: the farewell for a project quiet for a long while (people/farewell.js, server/tenure.mjs)
  farewell: {
    title: 'Perpisahan',
    on: 'Adakan perpisahan untuk proyek yang lama sepi',
    note: 'Proyek yang pernah aktif setidaknya dua hari lalu lama tidak membuka sesi akan mendapat acara perpisahan. Karakternya mengemas isi meja ke dalam kardus, semua orang menandatangani kartu, lalu ada kue kecil, foto bersama, dan kartu identitas dikembalikan ke HR. Adegan ini hanya terjadi di kantor. Proyekmu tetap utuh. Buka lagi proyek itu dan karakternya akan kembali ke kantor lama.',
    after: 'Setelah tidak aktif selama', days: { other: '{n} hari' },
  },
  // Settings → More: the prompt cache's clock (the cups on the desks)
  cache: {
    title: 'Cache prompt',
    note: 'Ada secangkir kopi di setiap meja yang sedang tidak dipakai. Uapnya memudar saat cache prompt sesi mendingin dan menghilang saat kopi sudah dingin. Mengirim pesan saat kopi masih hangat lebih murah. Setelah dingin, pesan berikutnya membuat seluruh percakapan dibaca ulang.',
    nudge: 'Beri tahu ponsel saya 5 menit sebelum cache sesi yang menunggu jawaban saya menjadi dingin',
  },
  chat: 'Obrolan grup',
  coachNote: 'Saat kamu menulis ke percakapan (“Kepada”), asisten menunjukkan bagian yang mungkin disalahartikan Claude di atas kolom pesan. Asisten ini berjalan di perangkatmu tanpa mengirim apa pun. Hanya “✨ Tulis ulang agar lebih jelas” yang meminta bantuan Claude.',
};
