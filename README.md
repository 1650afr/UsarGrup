# UsarGrup v1.1.0
Pembaruan tahap awal: panel Admin Utama dan verifikasi pendaftaran anggota.

## File paket
- `index.html`: halaman masuk, daftar, beranda, dan panel admin.
- `firebase.js`: konfigurasi koneksi Firebase UsarGrup.
- `app.js`: autentikasi, pembacaan profil, daftar pendaftaran, persetujuan/penolakan.
- `styles.css`: tampilan responsif.
- `firestore.rules`: pembatasan akses profil dan panel Admin Utama.

## PENTING: urutan pemasangan
1. Cadangkan file v1.0.0 di repository sebelum menggantinya.
2. Ganti kelima file aplikasi di root repository: `index.html`, `firebase.js`, `app.js`, `styles.css`, dan `firestore.rules`.
3. Publish isi `firestore.rules` ke Firebase Console > Firestore Database > Rules.
4. Setelah Rules berhasil dipublikasikan, buka Firestore Database > Data > `users` > dokumen UID akun Admin Utama yang sudah dibuat.
5. Tambahkan/ubah dua field berikut secara manual:
   - `role` (string) = `admin_utama`
   - `status` (string) = `active`
   Jangan mengubah UID dokumen atau field lain.
6. Commit kelima file ke branch `main` di GitHub. Tunggu GitHub Pages selesai memperbarui.
7. Buka ulang aplikasi, keluar lalu masuk kembali dengan akun Admin Utama.

## Pengamanan
- Pendaftaran mandiri selalu membuat `status: pending` dan `requestedRole: anggota`.
- Browser tidak menyediakan fungsi untuk mengangkat akun menjadi Admin Utama.
- Admin Utama ditetapkan manual melalui Firebase Console.
- Admin Utama dapat membaca daftar pengguna dan mengubah status/role melalui aturan Firestore.
- Persetujuan pendaftaran menetapkan `status: active` dan `role: anggota`.
- Penolakan menetapkan `status: rejected`.
- Penghapusan akun/profil tidak tersedia dari panel ini.

## Batasan versi 1.1.0
Versi ini baru menyediakan fondasi Admin Utama dan verifikasi pendaftaran. Pengelolaan UPA/grup, penetapan Admin UPA, struktur keanggotaan, Mutabaah, jadwal, absensi, laporan, notifikasi, dan passkey belum diimplementasikan. Uji dahulu dengan satu akun uji sebelum digunakan untuk data anggota sebenarnya.
