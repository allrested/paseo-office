export default {
  'people.handOver': 'Ada tugas baru buat kamu',
  'events.generic.grep': 'kode',
  'events.generic.web': 'web',
  'events.generic.fail': 'agen berhenti',
  'events.verb.prompt': '{label}',
  'events.verb.grep': 'cari {label}',
  'events.verb.web': 'cari {label}',
  'events.verb.plan': 'perbarui daftar tugas',
  'events.verb.test': 'jalankan {label}',
  'events.verb.testok': 'pengujian berhasil',
  'events.verb.testfail': 'pengujian gagal',
  'events.bubble.deploy': '{label} sudah dirilis',
  'events.verb.push': 'push kode',
  'events.verb.agent': 'mulai subagen',
  'events.bubble.agent': 'Aku serahkan ke subagen, ya',
  // (a context empties by a compaction or by a new conversation, and Paseo does not say which)
  'events.verb.compact': 'rapikan percakapan',
  'events.bubble.compact': 'Lagi merapikan percakapan',
  'people.shred.go': 'Mau ke mesin penghancur kertas dulu',
  // (the bell is rung by Paseo's stand-up card)
  'people.meet.standup': 'Stand-up, semuanya: lagi ngerjain apa?',
  'world.dev.lost': { other: '{n} agen meninggalkan proses yang masih berjalan' },
  'places.library.today': { other: '{n} kali baca sejak tampilan kantor ini dibuka' },
  'places.window.empty': 'Belum ada yang mencari di web sejak tampilan kantor ini dibuka.',
  'places.window.today': { other: '{n} pencarian web sejak tampilan kantor ini dibuka' },
  'places.deploy.sub': 'Setiap commit membuat printer mencetak. Roket meluncur setiap kali deploy berhasil.',
  'paseo.deploy.failed': 'Deploy gagal',
  // (the same words as the whiteboard's row: shared/model.ts waitingOnText)
  'paseo.subwait': { other: 'Menunggu {n} subagen' },
  // (the wall screen's tooltip while it opens Paseo's Resources: paseo-entry.js)
  'paseo.tv.resources': 'Buka Sumber Daya',
  // (the wall clock: it changes nothing, see paseo-entry.js)
  'paseo.clock.hint': 'Pencahayaan mengikuti tema aplikasi',
  // (the tour's card for a person: the card Paseo opens has no prompt, file or command in it)
  'tips.person.title': 'Setiap orang mewakili satu agen',
  'tips.person.text': 'Klik seseorang untuk membuka kartunya. Di sana kamu bisa melihat apa yang sedang dia kerjakan dan membuka sesinya.',
  // (the label over the meeting room's screen: it opens Paseo's stand-up notes)
  'paseo.notes': 'Catatan stand-up',
  'places.deploy.today': { other: '{n} kali deploy sejak tampilan kantor ini dibuka' },
  'places.live.deployToday': '{n} sejauh ini',
  // (first-person play is not taken: nobody walks in to pick up a cue; and the box asks no price)
  'props.billiards.hint': 'Ajak dua orang yang sedang senggang untuk main biliar',
  'props.gametv.hint': 'Ajak dua orang yang sedang senggang untuk bertanding',
  'props.karaoke.hint': 'Ajak seseorang yang sedang senggang untuk bernyanyi',
  'props.karaoke.idle': 'Bilik karaoke sedang kosong',
  // the lively floor (paseo-leisure.js): what someone says on the way to a rest of their own
  'paseo.leisure.nap': 'Tidur sebentar',
  'paseo.leisure.fish': 'Lagi kasih makan ikan',
  'paseo.leisure.arcade': 'Main satu ronde di arkade',
  'paseo.leisure.cup': 'Lagi bikin kopi',
  'paseo.leisure.wc': 'Sebentar, ya',
  // (an incident is one Paseo's office found in a tracker, not three failures in five minutes: the newest on the banner)
  'incident.banner': 'Insiden: {key} {title}',
  'incident.more': '+{n} lagi',
};
