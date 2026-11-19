// Incidents, pushes, CI and reports (life/incidents.js), and "your turn" (life/your-turn.js).
export default {
  banner: 'Insiden: 3 kegagalan dalam 5 menit',
  bubble: 'Ada insiden!',
  pushed: '🚀 {name} baru saja melakukan push ke {branch}',
  ciRed: '🚨 CI merah: {label} · {repo}',
  ciRedDefault: 'pengujian gagal',
  ciGreen: '✅ CI kembali hijau: {label} · {repo}',
  deployed: '🚀 {name} baru saja melakukan deploy {label}',
  againFail: 'Gagal lagi! {text}',
  // a worker reporting a finished turn to the director
  report: 'Lapor, “{task}” sudah selesai',
  reportHidden: 'Lapor, tugasnya beres',
  reportNoTask: 'Lapor, semuanya beres',
  reportLeft: 'Sudah aku taruh di meja direktur',
  turn: {
    done: '{name} sudah selesai',
    body: 'Giliran kamu, yuk lihat hasilnya',
    none: 'Tidak ada sesi yang menunggu kamu.',
  },
};
