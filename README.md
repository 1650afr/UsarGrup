# UsarGrup v1.0.0
Kerangka awal web UsarGrup.

## File
- `index.html`: halaman masuk, pendaftaran, dan beranda awal.
- `firebase.js`: koneksi Firebase Authentication dan Firestore.
- `app.js`: masuk, daftar, reset kata sandi, keluar.
- `styles.css`: tampilan responsif.
- `firestore.rules`: aturan awal profil pengguna.

## Pengaturan Firebase
1. Pastikan Authentication > Sign-in method > Email/Password aktif.
2. Pastikan Cloud Firestore sudah dibuat.
3. Buka Firestore Database > Rules, ganti dengan isi `firestore.rules`, lalu Publish.

## Unggah ke GitHub
Unggah semua file di dalam paket ini ke root repository `1650afr/UsarGrup` (jangan unggah folder pembungkus ZIP).

## GitHub Pages
Settings > Pages > Deploy from a branch > `main` > `/(root)` > Save.
Alamat target: https://1650afr.github.io/UsarGrup/

## Batasan tahap awal
Pendaftaran membuat akun Auth dan profil berstatus `pending`. Fitur persetujuan admin, pengelolaan UPA/grup, Mutabaah, absensi, jadwal, laporan, Storage, dan passkey belum diimplementasikan. Aturan Firestore saat ini menutup koleksi selain profil pengguna. Penetapan admin harus melalui prosedur tepercaya, bukan dari browser.
