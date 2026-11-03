
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  doc, setDoc, serverTimestamp, getDoc, collection, query, where,
  getDocs, updateDoc, addDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentUser = null, currentProfile = null, busy = false;
let upaCache = [], memberCache = [];

function msg(el, text, kind = "") {
  el.textContent = text;
  el.className = "message " + kind;
}
function err(e) {
  const messages = {
    "auth/email-already-in-use": "Email sudah terdaftar. Silakan masuk.",
    "auth/invalid-email": "Format email tidak valid.",
    "auth/weak-password": "Gunakan kata sandi minimal 8 karakter.",
    "auth/invalid-credential": "Email atau kata sandi tidak sesuai.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "auth/network-request-failed": "Periksa koneksi internet.",
    "permission-denied": "Akses database ditolak. Periksa Firestore Security Rules."
  };
  return messages[e.code] || `${e.code || "Kesalahan"}: ${e.message || "Terjadi kesalahan."}`;
}
function tab(login) {
  $("login-form").hidden = !login;
  $("register-form").hidden = login;
  $("tab-login").classList.toggle("active", login);
  $("tab-register").classList.toggle("active", !login);
  msg($("auth-message"), "");
}
$("tab-login").onclick = () => tab(true);
$("tab-register").onclick = () => tab(false);

$("login-form").onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  msg($("auth-message"), "Sedang masuk...");
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-password").value);
  } catch (error) {
    console.error(error);
    msg($("auth-message"), err(error), "error");
  } finally { button.disabled = false; }
};

$("register-form").onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const name = $("register-name").value.trim();
  const email = $("register-email").value.trim();
  msg($("auth-message"), "Sedang membuat akun...");
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, $("register-password").value);
    await updateProfile(credential.user, { displayName: name });
    await setDoc(doc(db, "users", credential.user.uid), {
      uid: credential.user.uid, displayName: name, email,
      status: "pending", requestedRole: "anggota",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    msg($("auth-message"), "Pendaftaran berhasil. Menunggu verifikasi Admin Utama.", "success");
  } catch (error) {
    console.error(error);
    msg($("auth-message"), err(error), "error");
  } finally { button.disabled = false; }
};

$("forgot-password").onclick = async () => {
  const email = $("login-email").value.trim();
  if (!email) return msg($("auth-message"), "Isi email terlebih dahulu.", "error");
  try {
    await sendPasswordResetEmail(auth, email);
    msg($("auth-message"), "Jika email terdaftar, tautan pengaturan ulang kata sandi akan dikirim.", "success");
  } catch (error) { msg($("auth-message"), err(error), "error"); }
};
$("logout-button").onclick = () => signOut(auth);

function hideViews() {
  ["pending-view", "rejected-view", "inactive-view", "admin-view",
   "upa-admin-view", "members-admin-view", "member-view"]
    .forEach(id => $(id).hidden = true);
}
function showStatus(status) {
  const id = ({ pending: "pending-view", rejected: "rejected-view", inactive: "inactive-view" })[status] || "pending-view";
  $(id).hidden = false;
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    currentProfile = null;
    $("app-panel").hidden = true;
    $("auth-panel").hidden = false;
    tab(true);
    return;
  }
  $("auth-panel").hidden = true;
  $("app-panel").hidden = false;
  $("welcome-title").textContent = "Assalamu'alaikum, " + (user.displayName || "Pengguna");
  $("user-email").textContent = user.email || "";
  hideViews();
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists()) { showStatus("pending"); return; }
    currentProfile = snapshot.data();
    const role = currentProfile.role || "anggota";
    const status = currentProfile.status || "pending";
    if (status !== "active") { showStatus(status); return; }
    if (role === "admin_utama") {
      $("admin-view").hidden = false;
      $("upa-admin-view").hidden = false;
      $("members-admin-view").hidden = false;
      await Promise.all([loadPending(), loadUpas(), loadMembers()]);
    } else {
      $("member-view").hidden = false;
    }
  } catch (error) {
    console.error(error);
    showStatus("pending");
    msg($("admin-message"), err(error), "error");
  }
});

// Pendaftaran akun dan verifikasi Admin Utama
async function loadPending() {
  const list = $("pending-list");
  list.replaceChildren();
  try {
    const snapshot = await getDocs(query(collection(db, "users"), where("status", "==", "pending")));
    $("pending-count").textContent = snapshot.size + " menunggu";
    if (snapshot.empty) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Tidak ada pendaftaran yang menunggu verifikasi.";
      list.append(p);
    }
    snapshot.forEach(userDoc => {
      const data = userDoc.data();
      const card = document.createElement("article");
      card.className = "item";
      const info = document.createElement("div");
      const name = document.createElement("h3");
      name.textContent = data.displayName || "Nama belum diisi";
      const email = document.createElement("p");
      email.className = "muted";
      email.textContent = data.email || "-";
      info.append(name, email);
      const actions = document.createElement("div");
      actions.className = "actions";
      [["Setujui", "active", "primary"], ["Tolak", "rejected", "danger"]].forEach(([label, status, cls]) => {
        const button = document.createElement("button");
        button.type = "button"; button.className = cls; button.textContent = label;
        button.onclick = () => reviewRegistration(userDoc.id, status, button);
        actions.append(button);
      });
      card.append(info, actions); list.append(card);
    });
  } catch (error) { console.error(error); msg($("admin-message"), err(error), "error"); }
}
async function reviewRegistration(uid, status, button) {
  if (busy || !confirm(status === "active" ? "Setujui sebagai anggota biasa?" : "Tolak pendaftaran ini?")) return;
  busy = true; button.disabled = true;
  try {
    await updateDoc(doc(db, "users", uid), {
      status, role: "anggota", reviewedAt: serverTimestamp(),
      reviewedBy: currentUser.uid, updatedAt: serverTimestamp()
    });
    msg($("admin-message"), "Keputusan berhasil disimpan.", "success");
    await loadPending();
  } catch (error) { console.error(error); msg($("admin-message"), err(error), "error"); button.disabled = false; }
  finally { busy = false; }
}

// Modul Data UPA
function resetUpaForm() {
  $("upa-form").reset(); $("upa-edit-id").value = "";
  $("upa-form-title").textContent = "Tambah UPA";
  $("upa-submit").textContent = "Simpan UPA"; $("upa-cancel").hidden = true;
}
$("upa-cancel").onclick = resetUpaForm;
$("upa-refresh").onclick = loadUpas;
$("upa-form").onsubmit = async event => {
  event.preventDefault();
  if (currentProfile?.role !== "admin_utama" || busy) return;
  const button = $("upa-submit"); button.disabled = true;
  msg($("upa-message"), "Menyimpan UPA...");
  const id = $("upa-edit-id").value;
  const code = $("upa-code").value.trim().toUpperCase();
  try {
    const duplicates = await getDocs(query(collection(db, "upas"), where("kodeUPA", "==", code)));
    if (duplicates.docs.some(d => d.id !== id)) {
      msg($("upa-message"), "Kode UPA sudah digunakan. Gunakan kode lain.", "error");
      return;
    }
    const data = {
      namaUPA: $("upa-name").value.trim(), kodeUPA: code,
      wilayah: $("upa-region").value.trim(), alamat: $("upa-address").value.trim(),
      ketuaUPA: $("upa-chair").value.trim(), status: "active", updatedAt: serverTimestamp()
    };
    if (id) await updateDoc(doc(db, "upas", id), data);
    else await addDoc(collection(db, "upas"), { ...data, createdBy: currentUser.uid, createdAt: serverTimestamp() });
    msg($("upa-message"), id ? "Data UPA diperbarui." : "UPA berhasil ditambahkan.", "success");
    resetUpaForm(); await loadUpas();
  } catch (error) { console.error(error); msg($("upa-message"), err(error), "error"); }
  finally { button.disabled = false; }
};
async function loadUpas() {
  const list = $("upa-list"); list.replaceChildren();
  msg($("upa-message"), "Memuat data UPA...");
  try {
    const snapshot = await getDocs(collection(db, "upas"));
    upaCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    $("upa-count").textContent = upaCache.length + " UPA";
    refreshUpaSelectors();
    if (!upaCache.length) {
      const p = document.createElement("p"); p.className = "muted";
      p.textContent = "Belum ada UPA. Tambahkan UPA pertama melalui formulir."; list.append(p);
    }
    upaCache.sort((a,b) => (a.namaUPA || "").localeCompare(b.namaUPA || "", "id")).forEach(upa => {
      const card = document.createElement("article"); card.className = "item";
      const info = document.createElement("div"), title = document.createElement("h3");
      const detail = document.createElement("p"), badge = document.createElement("span");
      title.textContent = upa.namaUPA || "UPA tanpa nama";
      detail.className = "muted"; detail.textContent = (upa.kodeUPA || "-") + " • " + (upa.wilayah || "Wilayah belum diisi");
      badge.className = "pill"; badge.textContent = upa.status || "active";
      info.append(title, detail, badge);
      const actions = document.createElement("div"); actions.className = "actions";
      const edit = document.createElement("button"); edit.className = "secondary"; edit.textContent = "Edit";
      edit.onclick = () => {
        $("upa-edit-id").value = upa.id; $("upa-name").value = upa.namaUPA || "";
        $("upa-code").value = upa.kodeUPA || ""; $("upa-region").value = upa.wilayah || "";
        $("upa-address").value = upa.alamat || ""; $("upa-chair").value = upa.ketuaUPA || "";
        $("upa-form-title").textContent = "Edit UPA"; $("upa-submit").textContent = "Simpan perubahan";
        $("upa-cancel").hidden = false; $("upa-form").scrollIntoView({ behavior: "smooth" });
      };
      const toggle = document.createElement("button"); toggle.className = "secondary";
      toggle.textContent = upa.status === "inactive" ? "Aktifkan" : "Nonaktifkan";
      toggle.onclick = () => toggleUpa(upa.id, upa.status === "inactive" ? "active" : "inactive", toggle);
      actions.append(edit, toggle); card.append(info, actions); list.append(card);
    });
    msg($("upa-message"), "");
  } catch (error) { console.error(error); msg($("upa-message"), err(error), "error"); }
}
async function toggleUpa(id, status, button) {
  if (!confirm(status === "inactive" ? "Nonaktifkan UPA ini? Data tidak dihapus." : "Aktifkan kembali UPA ini?")) return;
  button.disabled = true;
  try {
    await updateDoc(doc(db, "upas", id), { status, updatedAt: serverTimestamp() });
    await loadUpas(); msg($("upa-message"), "Status UPA berhasil diubah.", "success");
  } catch (error) { console.error(error); msg($("upa-message"), err(error), "error"); button.disabled = false; }
}

// Modul Data Anggota: record anggota terpisah dari akun Firebase Authentication.
function refreshUpaSelectors() {
  const active = upaCache.filter(u => u.status !== "inactive");
  const currentFormValue = $("member-upa").value;
  const currentFilterValue = $("member-filter-upa").value;
  $("member-upa").replaceChildren(new Option("Pilih UPA", ""));
  $("member-filter-upa").replaceChildren(new Option("Semua UPA", ""));
  active.sort((a,b) => (a.namaUPA || "").localeCompare(b.namaUPA || "", "id")).forEach(upa => {
    $("member-upa").add(new Option(`${upa.namaUPA} (${upa.kodeUPA || "-"})`, upa.id));
    $("member-filter-upa").add(new Option(upa.namaUPA, upa.id));
  });
  if (active.some(u => u.id === currentFormValue)) $("member-upa").value = currentFormValue;
  if (upaCache.some(u => u.id === currentFilterValue)) $("member-filter-upa").value = currentFilterValue;
}
function resetMemberForm() {
  $("member-form").reset(); $("member-edit-id").value = "";
  $("member-form-title").textContent = "Tambah Anggota";
  $("member-submit").textContent = "Simpan Anggota"; $("member-cancel").hidden = true;
}
$("member-cancel").onclick = resetMemberForm;
$("member-refresh").onclick = loadMembers;
$("member-search").oninput = renderMembers;
$("member-filter-upa").onchange = renderMembers;
$("member-filter-status").onchange = renderMembers;

$("member-form").onsubmit = async event => {
  event.preventDefault();
  if (currentProfile?.role !== "admin_utama" || busy) return;
  const button = $("member-submit"); button.disabled = true;
  msg($("member-message"), "Menyimpan data anggota...");
  const id = $("member-edit-id").value;
  const upaId = $("member-upa").value;
  const upa = upaCache.find(item => item.id === upaId);
  if (!upa || upa.status === "inactive") {
    msg($("member-message"), "Pilih UPA yang aktif.", "error"); button.disabled = false; return;
  }
  const data = {
    nama: $("member-name").value.trim(),
    nomorHP: $("member-phone").value.trim(),
    email: $("member-email").value.trim(),
    upaId, namaUPA: upa.namaUPA || "", kodeUPA: upa.kodeUPA || "",
    jabatan: $("member-position").value.trim(),
    keterangan: $("member-notes").value.trim(),
    status: id ? (memberCache.find(m => m.id === id)?.status || "active") : "active",
    updatedAt: serverTimestamp(), updatedBy: currentUser.uid
  };
  try {
    if (id) await updateDoc(doc(db, "members", id), data);
    else await addDoc(collection(db, "members"), { ...data, createdAt: serverTimestamp(), createdBy: currentUser.uid });
    msg($("member-message"), id ? "Data anggota berhasil diperbarui." : "Anggota berhasil ditambahkan.", "success");
    resetMemberForm(); await loadMembers();
  } catch (error) { console.error(error); msg($("member-message"), err(error), "error"); }
  finally { button.disabled = false; }
};

async function loadMembers() {
  const list = $("member-list"); list.replaceChildren();
  msg($("member-message"), "Memuat data anggota...");
  try {
    const snapshot = await getDocs(collection(db, "members"));
    memberCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    $("member-count").textContent = memberCache.length + " anggota";
    renderMembers();
    msg($("member-message"), "");
  } catch (error) { console.error(error); msg($("member-message"), err(error), "error"); }
}
function renderMembers() {
  const list = $("member-list"); list.replaceChildren();
  const term = $("member-search").value.trim().toLowerCase();
  const upaId = $("member-filter-upa").value;
  const status = $("member-filter-status").value;
  const rows = memberCache.filter(m => {
    const searchable = [m.nama, m.nomorHP, m.email, m.namaUPA, m.kodeUPA].join(" ").toLowerCase();
    return (!term || searchable.includes(term)) && (!upaId || m.upaId === upaId) && (!status || m.status === status);
  }).sort((a,b) => (a.nama || "").localeCompare(b.nama || "", "id"));
  if (!rows.length) {
    const p = document.createElement("p"); p.className = "muted";
    p.textContent = memberCache.length ? "Tidak ada anggota yang sesuai dengan pencarian atau filter." : "Belum ada data anggota. Tambahkan anggota melalui formulir.";
    list.append(p); return;
  }
  rows.forEach(member => {
    const card = document.createElement("article"); card.className = "item";
    const info = document.createElement("div"), title = document.createElement("h3");
    const detail = document.createElement("p"), contact = document.createElement("p"), badge = document.createElement("span");
    title.textContent = member.nama || "Tanpa nama";
    detail.className = "muted"; detail.textContent = `${member.namaUPA || "UPA tidak diketahui"} • ${member.kodeUPA || "-"}`;
    contact.className = "muted";
    contact.textContent = [member.nomorHP, member.email, member.jabatan].filter(Boolean).join(" • ") || "Kontak belum diisi";
    badge.className = "pill"; badge.textContent = member.status || "active";
    info.append(title, detail, contact, badge);
    const actions = document.createElement("div"); actions.className = "actions";
    const edit = document.createElement("button"); edit.className = "secondary"; edit.textContent = "Edit";
    edit.onclick = () => {
      $("member-edit-id").value = member.id; $("member-name").value = member.nama || "";
      $("member-phone").value = member.nomorHP || ""; $("member-email").value = member.email || "";
      $("member-upa").value = member.upaId || ""; $("member-position").value = member.jabatan || "";
      $("member-notes").value = member.keterangan || "";
      $("member-form-title").textContent = "Edit Anggota"; $("member-submit").textContent = "Simpan perubahan";
      $("member-cancel").hidden = false; $("member-form").scrollIntoView({ behavior: "smooth" });
    };
    const toggle = document.createElement("button"); toggle.className = "secondary";
    toggle.textContent = member.status === "inactive" ? "Aktifkan" : "Nonaktifkan";
    toggle.onclick = () => toggleMember(member.id, member.status === "inactive" ? "active" : "inactive", toggle);
    actions.append(edit, toggle); card.append(info, actions); list.append(card);
  });
}
async function toggleMember(id, status, button) {
  if (!confirm(status === "inactive" ? "Nonaktifkan anggota ini? Data tidak dihapus." : "Aktifkan kembali anggota ini?")) return;
  button.disabled = true;
  try {
    await updateDoc(doc(db, "members", id), { status, updatedAt: serverTimestamp(), updatedBy: currentUser.uid });
    await loadMembers(); msg($("member-message"), "Status anggota berhasil diubah.", "success");
  } catch (error) { console.error(error); msg($("member-message"), err(error), "error"); button.disabled = false; }
}
