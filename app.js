
import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  addDoc,
  deleteField
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let busy = false;

let upaCache = [];
let memberCache = [];
let adminUserCache = [];
let adminUpaCache = [];
let assignedUPA = null;
let adminUpaMemberCache = [];

let groupCache = [];
let groupMembershipCache = [];
let groupMemberCache = [];

const GROUP_TYPES = [
  "Muntazhim",
  "Muntashib",
  "Muayyid",
  "Muhib",
  "Tamhidi"
];

function msg(el, text, kind = "") {
  if (!el) return;
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
    "permission-denied": "Akses database ditolak. Periksa hak akses Firestore.",
    "failed-precondition": "Operasi belum dapat dilakukan. Periksa konfigurasi database."
  };

  return messages[e.code] ||
    `${e.code || "Kesalahan"}: ${e.message || "Terjadi kesalahan."}`;
}

function isAdminUtama() {
  return currentProfile?.role === "admin_utama" &&
    currentProfile?.status === "active";
}

function isAdminUPA() {
  return currentProfile?.role === "admin_upa" &&
    currentProfile?.status === "active" &&
    typeof currentProfile?.upaId === "string" &&
    currentProfile.upaId.length > 0;
}

function canManageGroups() {
  return isAdminUtama() || (isAdminUPA() && !!assignedUPA);
}

function hideViews() {
  [
    "pending-view",
    "rejected-view",
    "inactive-view",
    "admin-view",
    "upa-admin-view",
    "upa-manager-view",
    "members-admin-view",
    "admin-upa-view",
    "admin-upa-members-view",
    "groups-admin-view",
    "group-membership-view",
    "member-view"
  ].forEach(id => {
    if ($(id)) $(id).hidden = true;
  });
}

function showStatus(status) {
  const id = ({
    pending: "pending-view",
    rejected: "rejected-view",
    inactive: "inactive-view"
  })[status] || "pending-view";

  if ($(id)) $(id).hidden = false;
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

// ======================================================
// LOGIN DAN PENDAFTARAN
// ======================================================

$("login-form").onsubmit = async event => {
  event.preventDefault();

  const button = event.submitter;
  button.disabled = true;
  msg($("auth-message"), "Sedang masuk...");

  try {
    await signInWithEmailAndPassword(
      auth,
      $("login-email").value.trim(),
      $("login-password").value
    );
  } catch (error) {
    console.error(error);
    msg($("auth-message"), err(error), "error");
  } finally {
    button.disabled = false;
  }
};

$("register-form").onsubmit = async event => {
  event.preventDefault();

  const button = event.submitter;
  button.disabled = true;

  const name = $("register-name").value.trim();
  const email = $("register-email").value.trim();

  msg($("auth-message"), "Sedang membuat akun...");

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      $("register-password").value
    );

    await updateProfile(credential.user, {
      displayName: name
    });

    await setDoc(doc(db, "users", credential.user.uid), {
      uid: credential.user.uid,
      displayName: name,
      email,
      status: "pending",
      requestedRole: "anggota",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    msg(
      $("auth-message"),
      "Pendaftaran berhasil. Menunggu verifikasi Admin Utama.",
      "success"
    );
  } catch (error) {
    console.error(error);
    msg($("auth-message"), err(error), "error");
  } finally {
    button.disabled = false;
  }
};

$("forgot-password").onclick = async () => {
  const email = $("login-email").value.trim();

  if (!email) {
    return msg(
      $("auth-message"),
      "Isi email terlebih dahulu.",
      "error"
    );
  }

  try {
    await sendPasswordResetEmail(auth, email);
    msg(
      $("auth-message"),
      "Jika email terdaftar, tautan pengaturan ulang kata sandi akan dikirim.",
      "success"
    );
  } catch (error) {
    msg($("auth-message"), err(error), "error");
  }
};

$("logout-button").onclick = () => signOut(auth);

// ======================================================
// PEMERIKSAAN AKUN DAN HAK AKSES
// ======================================================

onAuthStateChanged(auth, async user => {
  currentUser = user;
  currentProfile = null;
  assignedUPA = null;

  groupCache = [];
  groupMembershipCache = [];
  groupMemberCache = [];

  if (!user) {
    $("app-panel").hidden = true;
    $("auth-panel").hidden = false;
    tab(true);
    return;
  }

  $("auth-panel").hidden = true;
  $("app-panel").hidden = false;

  $("welcome-title").textContent =
    "Assalamu'alaikum, " + (user.displayName || "Pengguna");

  $("user-email").textContent = user.email || "";

  hideViews();

  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));

    if (!snapshot.exists()) {
      showStatus("pending");
      return;
    }

    currentProfile = snapshot.data();

    const role = currentProfile.role || "anggota";
    const status = currentProfile.status || "pending";

    if (status !== "active") {
      showStatus(status);
      return;
    }

    if (role === "admin_utama") {
      $("admin-view").hidden = false;
      $("upa-admin-view").hidden = false;
      $("upa-manager-view").hidden = false;
      $("members-admin-view").hidden = false;
      $("groups-admin-view").hidden = false;

      await Promise.all([
        loadPending(),
        loadUpas(),
        loadMembers(),
        loadAdminUsers(),
        loadGroups()
      ]);

    } else if (role === "admin_upa") {
      if (!currentProfile.upaId) {
        showStatus("inactive");
        return;
      }

      $("admin-upa-view").hidden = false;
      $("groups-admin-view").hidden = false;

      await loadAssignedUPA();

      if (assignedUPA) {
        await Promise.all([
          loadAdminUPAMembers(),
          loadGroups()
        ]);
      }

    } else {
      $("member-view").hidden = false;
    }

  } catch (error) {
    console.error(error);
    showStatus("pending");
    msg($("admin-message"), err(error), "error");
    msg($("group-message"), err(error), "error");
  }
});

// ======================================================
// VERIFIKASI PENDAFTARAN
// ======================================================

async function loadPending() {
  const list = $("pending-list");
  list.replaceChildren();

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "users"),
        where("status", "==", "pending")
      )
    );

    $("pending-count").textContent =
      snapshot.size + " menunggu";

    if (snapshot.empty) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent =
        "Tidak ada pendaftaran yang menunggu verifikasi.";
      list.append(p);
    }

    snapshot.forEach(userDoc => {
      const data = userDoc.data();

      const card = document.createElement("article");
      card.className = "item";

      const info = document.createElement("div");
      const name = document.createElement("h3");
      const email = document.createElement("p");

      name.textContent = data.displayName || "Nama belum diisi";
      email.className = "muted";
      email.textContent = data.email || "-";

      info.append(name, email);

      const actions = document.createElement("div");
      actions.className = "actions";

      [
        ["Setujui", "active", "primary"],
        ["Tolak", "rejected", "danger"]
      ].forEach(([label, status, cls]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = cls;
        button.textContent = label;
        button.onclick = () =>
          reviewRegistration(userDoc.id, status, button);
        actions.append(button);
      });

      card.append(info, actions);
      list.append(card);
    });

  } catch (error) {
    console.error(error);
    msg($("admin-message"), err(error), "error");
  }
}

async function reviewRegistration(uid, status, button) {
  if (
    busy ||
    !confirm(
      status === "active"
        ? "Setujui sebagai anggota biasa?"
        : "Tolak pendaftaran ini?"
    )
  ) return;

  busy = true;
  button.disabled = true;

  try {
    await updateDoc(doc(db, "users", uid), {
      status,
      role: "anggota",
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUser.uid,
      updatedAt: serverTimestamp()
    });

    msg($("admin-message"), "Keputusan berhasil disimpan.", "success");
    await loadPending();

  } catch (error) {
    console.error(error);
    msg($("admin-message"), err(error), "error");
    button.disabled = false;
  } finally {
    busy = false;
  }
}

// ======================================================
// MODUL DATA UPA
// ======================================================

function resetUpaForm() {
  $("upa-form").reset();
  $("upa-edit-id").value = "";
  $("upa-form-title").textContent = "Tambah UPA";
  $("upa-submit").textContent = "Simpan UPA";
  $("upa-cancel").hidden = true;
}

$("upa-cancel").onclick = resetUpaForm;
$("upa-refresh").onclick = loadUpas;

$("upa-form").onsubmit = async event => {
  event.preventDefault();
  if (!isAdminUtama() || busy) return;

  const button = $("upa-submit");
  button.disabled = true;
  msg($("upa-message"), "Menyimpan UPA...");

  const id = $("upa-edit-id").value;
  const code = $("upa-code").value.trim().toUpperCase();

  try {
    const duplicates = await getDocs(
      query(collection(db, "upas"), where("kodeUPA", "==", code))
    );

    if (duplicates.docs.some(d => d.id !== id)) {
      msg($("upa-message"), "Kode UPA sudah digunakan. Gunakan kode lain.", "error");
      return;
    }

    const data = {
      namaUPA: $("upa-name").value.trim(),
      kodeUPA: code,
      wilayah: $("upa-region").value.trim(),
      alamat: $("upa-address").value.trim(),
      ketuaUPA: $("upa-chair").value.trim(),
      status: "active",
      updatedAt: serverTimestamp()
    };

    if (id) {
      await updateDoc(doc(db, "upas", id), data);
    } else {
      await addDoc(collection(db, "upas"), {
        ...data,
        createdBy: currentUser.uid,
        createdAt: serverTimestamp()
      });
    }

    msg(
      $("upa-message"),
      id ? "Data UPA diperbarui." : "UPA berhasil ditambahkan.",
      "success"
    );

    resetUpaForm();
    await loadUpas();

  } catch (error) {
    console.error(error);
    msg($("upa-message"), err(error), "error");
  } finally {
    button.disabled = false;
  }
};

async function loadUpas() {
  const list = $("upa-list");
  list.replaceChildren();
  msg($("upa-message"), "Memuat data UPA...");

  try {
    const snapshot = await getDocs(collection(db, "upas"));

    upaCache = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    $("upa-count").textContent = upaCache.length + " UPA";

    refreshUpaSelectors();
    refreshAdminUPASelectors();

    if (!upaCache.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Belum ada UPA. Tambahkan UPA pertama melalui formulir.";
      list.append(p);
    }

    upaCache
      .sort((a, b) => (a.namaUPA || "").localeCompare(b.namaUPA || "", "id"))
      .forEach(upa => {
        const card = document.createElement("article");
        card.className = "item";

        const info = document.createElement("div");
        const title = document.createElement("h3");
        const detail = document.createElement("p");
        const badge = document.createElement("span");

        title.textContent = upa.namaUPA || "UPA tanpa nama";
        detail.className = "muted";
        detail.textContent =
          (upa.kodeUPA || "-") + " • " + (upa.wilayah || "Wilayah belum diisi");

        badge.className = "pill";
        badge.textContent = upa.status || "active";
        info.append(title, detail, badge);

        const actions = document.createElement("div");
        actions.className = "actions";

        const edit = document.createElement("button");
        edit.className = "secondary";
        edit.textContent = "Edit";
        edit.onclick = () => {
          $("upa-edit-id").value = upa.id;
          $("upa-name").value = upa.namaUPA || "";
          $("upa-code").value = upa.kodeUPA || "";
          $("upa-region").value = upa.wilayah || "";
          $("upa-address").value = upa.alamat || "";
          $("upa-chair").value = upa.ketuaUPA || "";
          $("upa-form-title").textContent = "Edit UPA";
          $("upa-submit").textContent = "Simpan perubahan";
          $("upa-cancel").hidden = false;
          $("upa-form").scrollIntoView({ behavior: "smooth" });
        };

        const toggle = document.createElement("button");
        toggle.className = "secondary";
        toggle.textContent = upa.status === "inactive" ? "Aktifkan" : "Nonaktifkan";
        toggle.onclick = () =>
          toggleUpa(upa.id, upa.status === "inactive" ? "active" : "inactive", toggle);

        actions.append(edit, toggle);
        card.append(info, actions);
        list.append(card);
      });

    msg($("upa-message"), "");

  } catch (error) {
    console.error(error);
    msg($("upa-message"), err(error), "error");
  }
}

async function toggleUpa(id, status, button) {
  if (!confirm(
    status === "inactive"
      ? "Nonaktifkan UPA ini? Data tidak dihapus."
      : "Aktifkan kembali UPA ini?"
  )) return;

  button.disabled = true;

  try {
    await updateDoc(doc(db, "upas", id), {
      status,
      updatedAt: serverTimestamp()
    });

    await loadUpas();
    msg($("upa-message"), "Status UPA berhasil diubah.", "success");

  } catch (error) {
    console.error(error);
    msg($("upa-message"), err(error), "error");
    button.disabled = false;
  }
}

// ======================================================
// PEMILIHAN UPA
// ======================================================

function refreshUpaSelectors() {
  const active = upaCache.filter(u => u.status !== "inactive");
  const currentFormValue = $("member-upa").value;
  const currentFilterValue = $("member-filter-upa").value;

  $("member-upa").replaceChildren(new Option("Pilih UPA", ""));
  $("member-filter-upa").replaceChildren(new Option("Semua UPA", ""));

  active
    .sort((a, b) => (a.namaUPA || "").localeCompare(b.namaUPA || "", "id"))
    .forEach(upa => {
      $("member-upa").add(
        new Option(`${upa.namaUPA} (${upa.kodeUPA || "-"})`, upa.id)
      );
      $("member-filter-upa").add(new Option(upa.namaUPA, upa.id));
    });

  if (active.some(u => u.id === currentFormValue)) {
    $("member-upa").value = currentFormValue;
  }

  if (upaCache.some(u => u.id === currentFilterValue)) {
    $("member-filter-upa").value = currentFilterValue;
  }
}

function refreshAdminUPASelectors() {
  const active = upaCache.filter(u => u.status !== "inactive");
  const userSelect = $("upa-admin-user");
  const upaSelect = $("upa-admin-select");

  if (!userSelect || !upaSelect) return;

  const oldUser = userSelect.value;
  const oldUPA = upaSelect.value;

  userSelect.replaceChildren(new Option("Pilih akun anggota", ""));
  upaSelect.replaceChildren(new Option("Pilih UPA", ""));

  adminUserCache
    .filter(u => u.status === "active" && (u.role || "anggota") === "anggota")
    .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "id"))
    .forEach(u => {
      userSelect.add(
        new Option(`${u.displayName || "Tanpa nama"} — ${u.email || "-"}`, u.id)
      );
    });

  active
    .sort((a, b) => (a.namaUPA || "").localeCompare(b.namaUPA || "", "id"))
    .forEach(u => {
      upaSelect.add(new Option(`${u.namaUPA} (${u.kodeUPA || "-"})`, u.id));
    });

  if ([...userSelect.options].some(o => o.value === oldUser)) {
    userSelect.value = oldUser;
  }

  if ([...upaSelect.options].some(o => o.value === oldUPA)) {
    upaSelect.value = oldUPA;
  }
}

// ======================================================
// PENGELOLAAN ADMIN UPA
// ======================================================

async function loadAdminUsers() {
  try {
    const snapshot = await getDocs(
      query(collection(db, "users"), where("status", "==", "active"))
    );

    adminUserCache = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    adminUpaCache = adminUserCache.filter(u => u.role === "admin_upa");

    $("upa-admin-count").textContent = adminUpaCache.length + " Admin UPA";
    refreshAdminUPASelectors();
    renderAdminUPAList();

  } catch (error) {
    console.error(error);
    msg($("upa-admin-message"), err(error), "error");
  }
}

$("upa-admin-refresh").onclick = loadAdminUsers;

$("upa-admin-form").onsubmit = async event => {
  event.preventDefault();
  if (!isAdminUtama() || busy) return;

  const button = $("upa-admin-submit");
  button.disabled = true;

  const uid = $("upa-admin-user").value;
  const upaId = $("upa-admin-select").value;

  if (!uid || !upaId) {
    msg($("upa-admin-message"), "Pilih akun dan UPA terlebih dahulu.", "error");
    button.disabled = false;
    return;
  }

  const selectedUPA = upaCache.find(u => u.id === upaId);

  if (!selectedUPA || selectedUPA.status === "inactive") {
    msg($("upa-admin-message"), "UPA tidak ditemukan atau sedang tidak aktif.", "error");
    button.disabled = false;
    return;
  }

  if (!confirm(
    "Tetapkan akun ini sebagai Admin UPA " + selectedUPA.namaUPA + "?"
  )) {
    button.disabled = false;
    return;
  }

  try {
    const userRef = doc(db, "users", uid);
    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) throw new Error("Akun tidak ditemukan.");

    const userData = userSnapshot.data();

    if (
      userData.status !== "active" ||
      (userData.role || "anggota") !== "anggota"
    ) {
      throw new Error("Akun harus berstatus aktif dan berperan sebagai anggota.");
    }

    await updateDoc(userRef, {
      role: "admin_upa",
      upaId,
      namaUPA: selectedUPA.namaUPA || "",
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    });

    msg($("upa-admin-message"), "Admin UPA berhasil ditetapkan.", "success");
    $("upa-admin-form").reset();
    await loadAdminUsers();

  } catch (error) {
    console.error(error);
    msg($("upa-admin-message"), err(error), "error");
  } finally {
    button.disabled = false;
  }
};

function renderAdminUPAList() {
  const list = $("upa-admin-list");
  list.replaceChildren();

  if (!adminUpaCache.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Belum ada Admin UPA yang ditetapkan.";
    list.append(p);
    return;
  }

  adminUpaCache
    .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "id"))
    .forEach(user => {
      const card = document.createElement("article");
      card.className = "item";

      const info = document.createElement("div");
      const title = document.createElement("h3");
      const email = document.createElement("p");
      const upa = document.createElement("p");

      title.textContent = user.displayName || "Tanpa nama";
      email.className = "muted";
      email.textContent = user.email || "-";
      upa.className = "muted";
      upa.textContent = "UPA: " + (user.namaUPA || user.upaId || "-");

      info.append(title, email, upa);

      const actions = document.createElement("div");
      actions.className = "actions";

      const revoke = document.createElement("button");
      revoke.className = "danger";
      revoke.textContent = "Cabut Admin UPA";
      revoke.onclick = () => revokeAdminUPA(user.id, revoke);

      actions.append(revoke);
      card.append(info, actions);
      list.append(card);
    });
}

async function revokeAdminUPA(uid, button) {
  if (!confirm(
    "Cabut hak Admin UPA akun ini? Akun akan kembali menjadi anggota biasa."
  )) return;

  button.disabled = true;

  try {
    await updateDoc(doc(db, "users", uid), {
      role: "anggota",
      upaId: deleteField(),
      namaUPA: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    });

    msg($("upa-admin-message"), "Hak Admin UPA berhasil dicabut.", "success");
    await loadAdminUsers();

  } catch (error) {
    console.error(error);
    msg($("upa-admin-message"), err(error), "error");
    button.disabled = false;
  }
}

// ======================================================
// DATA ANGGOTA ADMIN UTAMA
// ======================================================

function resetMemberForm() {
  $("member-form").reset();
  $("member-edit-id").value = "";
  $("member-form-title").textContent = "Tambah Anggota";
  $("member-submit").textContent = "Simpan Anggota";
  $("member-cancel").hidden = true;
}

$("member-cancel").onclick = resetMemberForm;
$("member-refresh").onclick = loadMembers;
$("member-search").oninput = renderMembers;
$("member-filter-upa").onchange = renderMembers;
$("member-filter-status").onchange = renderMembers;

$("member-form").onsubmit = async event => {
  event.preventDefault();
  if (!isAdminUtama() || busy) return;

  const button = $("member-submit");
  button.disabled = true;
  msg($("member-message"), "Menyimpan data anggota...");

  const id = $("member-edit-id").value;
  const upaId = $("member-upa").value;
  const upa = upaCache.find(item => item.id === upaId);

  if (!upa || upa.status === "inactive") {
    msg($("member-message"), "Pilih UPA yang aktif.", "error");
    button.disabled = false;
    return;
  }

  const data = {
    nama: $("member-name").value.trim(),
    nomorHP: $("member-phone").value.trim(),
    email: $("member-email").value.trim(),
    upaId,
    namaUPA: upa.namaUPA || "",
    kodeUPA: upa.kodeUPA || "",
    jabatan: $("member-position").value.trim(),
    keterangan: $("member-notes").value.trim(),
    status: id ? (memberCache.find(m => m.id === id)?.status || "active") : "active",
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  };

  try {
    if (id) {
      await updateDoc(doc(db, "members", id), data);
    } else {
      await addDoc(collection(db, "members"), {
        ...data,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });
    }

    msg(
      $("member-message"),
      id ? "Data anggota berhasil diperbarui." : "Anggota berhasil ditambahkan.",
      "success"
    );

    resetMemberForm();
    await loadMembers();

  } catch (error) {
    console.error(error);
    msg($("member-message"), err(error), "error");
  } finally {
    button.disabled = false;
  }
};

async function loadMembers() {
  const list = $("member-list");
  list.replaceChildren();
  msg($("member-message"), "Memuat data anggota...");

  try {
    const snapshot = await getDocs(collection(db, "members"));

    memberCache = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    $("member-count").textContent = memberCache.length + " anggota";
    renderMembers();
    msg($("member-message"), "");

  } catch (error) {
    console.error(error);
    msg($("member-message"), err(error), "error");
  }
}

function renderMembers() {
  const list = $("member-list");
  list.replaceChildren();

  const term = $("member-search").value.trim().toLowerCase();
  const upaId = $("member-filter-upa").value;
  const status = $("member-filter-status").value;

  const rows = memberCache
    .filter(m => {
      const searchable = [
        m.nama, m.nomorHP, m.email, m.namaUPA, m.kodeUPA
      ].join(" ").toLowerCase();

      return (!term || searchable.includes(term)) &&
        (!upaId || m.upaId === upaId) &&
        (!status || m.status === status);
    })
    .sort((a, b) => (a.nama || "").localeCompare(b.nama || "", "id"));

  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = memberCache.length
      ? "Tidak ada anggota yang sesuai dengan pencarian atau filter."
      : "Belum ada data anggota. Tambahkan anggota melalui formulir.";
    list.append(p);
    return;
  }

  rows.forEach(member => {
    const card = document.createElement("article");
    card.className = "item";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    const detail = document.createElement("p");
    const contact = document.createElement("p");
    const badge = document.createElement("span");

    title.textContent = member.nama || "Tanpa nama";
    detail.className = "muted";
    detail.textContent =
      `${member.namaUPA || "UPA tidak diketahui"} • ${member.kodeUPA || "-"}`;
    contact.className = "muted";
    contact.textContent = [
      member.nomorHP, member.email, member.jabatan
    ].filter(Boolean).join(" • ") || "Kontak belum diisi";
    badge.className = "pill";
    badge.textContent = member.status || "active";

    info.append(title, detail, contact, badge);

    const actions = document.createElement("div");
    actions.className = "actions";

    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.onclick = () => {
      $("member-edit-id").value = member.id;
      $("member-name").value = member.nama || "";
      $("member-phone").value = member.nomorHP || "";
      $("member-email").value = member.email || "";
      $("member-upa").value = member.upaId || "";
      $("member-position").value = member.jabatan || "";
      $("member-notes").value = member.keterangan || "";
      $("member-form-title").textContent = "Edit Anggota";
      $("member-submit").textContent = "Simpan perubahan";
      $("member-cancel").hidden = false;
      $("member-form").scrollIntoView({ behavior: "smooth" });
    };

    const toggle = document.createElement("button");
    toggle.className = "secondary";
    toggle.textContent = member.status === "inactive" ? "Aktifkan" : "Nonaktifkan";
    toggle.onclick = () =>
      toggleMember(member.id, member.status === "inactive" ? "active" : "inactive", toggle);

    actions.append(edit, toggle);
    card.append(info, actions);
    list.append(card);
  });
}

async function toggleMember(id, status, button) {
  if (!confirm(
    status === "inactive"
      ? "Nonaktifkan anggota ini? Data tidak dihapus."
      : "Aktifkan kembali anggota ini?"
  )) return;

  button.disabled = true;

  try {
    await updateDoc(doc(db, "members", id), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    });

    await loadMembers();
    await loadGroups();

    msg($("member-message"), "Status anggota berhasil diubah.", "success");

  } catch (error) {
    console.error(error);
    msg($("member-message"), err(error), "error");
    button.disabled = false;
  }
}

// ======================================================
// PANEL ADMIN UPA
// ======================================================

async function loadAssignedUPA() {
  try {
    const upaId = currentProfile.upaId;
    const snapshot = await getDoc(doc(db, "upas", upaId));

    if (!snapshot.exists()) {
      throw new Error("Data UPA penugasan tidak ditemukan.");
    }

    assignedUPA = {
      id: snapshot.id,
      ...snapshot.data()
    };

    if (assignedUPA.status === "inactive") {
      throw new Error("UPA ini sedang tidak aktif. Hubungi Admin Utama.");
    }

    $("admin-upa-title").textContent = "Panel Admin UPA";
    $("admin-upa-identity").textContent =
      `${assignedUPA.namaUPA || "-"} (${assignedUPA.kodeUPA || "-"}) • ${assignedUPA.wilayah || "-"}`;
    $("admin-upa-status").textContent = "Aktif";

  } catch (error) {
    console.error(error);
    assignedUPA = null;
    $("admin-upa-identity").textContent = err(error);
    $("admin-upa-members-view").hidden = true;
    $("groups-admin-view").hidden = true;
  }
}

function resetAdminUPAMemberForm() {
  $("admin-upa-member-form").reset();
  $("admin-upa-member-edit-id").value = "";
  $("admin-upa-member-form-title").textContent = "Tambah Anggota";
  $("admin-upa-member-submit").textContent = "Simpan Anggota";
  $("admin-upa-member-cancel").hidden = true;
}

$("admin-upa-member-cancel").onclick = resetAdminUPAMemberForm;
$("admin-upa-member-refresh").onclick = loadAdminUPAMembers;
$("admin-upa-member-search").oninput = renderAdminUPAMembers;
$("admin-upa-member-filter-status").onchange = renderAdminUPAMembers;

$("admin-upa-member-form").onsubmit = async event => {
  event.preventDefault();
  if (!isAdminUPA() || busy || !assignedUPA) return;

  const button = $("admin-upa-member-submit");
  button.disabled = true;
  msg($("admin-upa-member-message"), "Menyimpan data anggota...");

  const id = $("admin-upa-member-edit-id").value;

  const data = {
    nama: $("admin-upa-member-name").value.trim(),
    nomorHP: $("admin-upa-member-phone").value.trim(),
    email: $("admin-upa-member-email").value.trim(),
    upaId: assignedUPA.id,
    namaUPA: assignedUPA.namaUPA || "",
    kodeUPA: assignedUPA.kodeUPA || "",
    jabatan: $("admin-upa-member-position").value.trim(),
    keterangan: $("admin-upa-member-notes").value.trim(),
    status: id
      ? (adminUpaMemberCache.find(m => m.id === id)?.status || "active")
      : "active",
    updatedAt: serverTimestamp(),
    updatedBy: currentUser.uid
  };

  try {
    if (id) {
      const existing = adminUpaMemberCache.find(m => m.id === id);

      if (!existing || existing.upaId !== assignedUPA.id) {
        throw new Error("Anggota tidak termasuk UPA yang Anda kelola.");
      }

      await updateDoc(doc(db, "members", id), data);

    } else {
      await addDoc(collection(db, "members"), {
        ...data,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });
    }

    msg(
      $("admin-upa-member-message"),
      id ? "Data anggota berhasil diperbarui." : "Anggota berhasil ditambahkan.",
      "success"
    );

    resetAdminUPAMemberForm();
    await loadAdminUPAMembers();

  } catch (error) {
    console.error(error);
    msg($("admin-upa-member-message"), err(error), "error");
  } finally {
    button.disabled = false;
  }
};

async function loadAdminUPAMembers() {
  if (!isAdminUPA() || !assignedUPA) return;

  const list = $("admin-upa-member-list");
  list.replaceChildren();
  msg($("admin-upa-member-message"), "Memuat anggota UPA...");

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "members"),
        where("upaId", "==", assignedUPA.id)
      )
    );

    adminUpaMemberCache = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    $("admin-upa-member-count").textContent =
      adminUpaMemberCache.length + " anggota";

    renderAdminUPAMembers();
    msg($("admin-upa-member-message"), "");

  } catch (error) {
    console.error(error);
    msg($("admin-upa-member-message"), err(error), "error");
  }
}

function renderAdminUPAMembers() {
  const list = $("admin-upa-member-list");
  list.replaceChildren();

  const term = $("admin-upa-member-search").value.trim().toLowerCase();
  const status = $("admin-upa-member-filter-status").value;

  const rows = adminUpaMemberCache
    .filter(member => {
      const searchable = [
        member.nama, member.nomorHP, member.email, member.jabatan
      ].join(" ").toLowerCase();

      return (!term || searchable.includes(term)) &&
        (!status || member.status === status);
    })
    .sort((a, b) => (a.nama || "").localeCompare(b.nama || "", "id"));

  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = adminUpaMemberCache.length
      ? "Tidak ada anggota yang sesuai dengan pencarian."
      : "Belum ada anggota pada UPA ini.";
    list.append(p);
    return;
  }

  rows.forEach(member => {
    const card = document.createElement("article");
    card.className = "item";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    const contact = document.createElement("p");
    const badge = document.createElement("span");

    title.textContent = member.nama || "Tanpa nama";
    contact.className = "muted";
    contact.textContent = [
      member.nomorHP, member.email, member.jabatan
    ].filter(Boolean).join(" • ") || "Kontak belum diisi";
    badge.className = "pill";
    badge.textContent = member.status || "active";

    info.append(title, contact, badge);

    const actions = document.createElement("div");
    actions.className = "actions";

    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.onclick = () => {
      $("admin-upa-member-edit-id").value = member.id;
      $("admin-upa-member-name").value = member.nama || "";
      $("admin-upa-member-phone").value = member.nomorHP || "";
      $("admin-upa-member-email").value = member.email || "";
      $("admin-upa-member-position").value = member.jabatan || "";
      $("admin-upa-member-notes").value = member.keterangan || "";
      $("admin-upa-member-form-title").textContent = "Edit Anggota";
      $("admin-upa-member-submit").textContent = "Simpan perubahan";
      $("admin-upa-member-cancel").hidden = false;
      $("admin-upa-member-form").scrollIntoView({ behavior: "smooth" });
    };

    const toggle = document.createElement("button");
    toggle.className = "secondary";
    toggle.textContent = member.status === "inactive" ? "Aktifkan" : "Nonaktifkan";
    toggle.onclick = () =>
      toggleAdminUPAMember(
        member.id,
        member.status === "inactive" ? "active" : "inactive",
        toggle
      );

    actions.append(edit, toggle);
    card.append(info, actions);
    list.append(card);
  });
}

async function toggleAdminUPAMember(id, status, button) {
  if (!isAdminUPA() || !assignedUPA) return;

  if (!confirm(
    status === "inactive"
      ? "Nonaktifkan anggota ini? Data tidak dihapus."
      : "Aktifkan kembali anggota ini?"
  )) return;

  const existing = adminUpaMemberCache.find(m => m.id === id);

  if (!existing || existing.upaId !== assignedUPA.id) {
    msg(
      $("admin-upa-member-message"),
      "Akses ditolak. Anggota bukan bagian dari UPA Anda.",
      "error"
    );
    return;
  }

  button.disabled = true;

  try {
    await updateDoc(doc(db, "members", id), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    });

    await loadAdminUPAMembers();
    await loadGroups();

    msg($("admin-upa-member-message"), "Status anggota berhasil diubah.", "success");

  } catch (error) {
    console.error(error);
    msg($("admin-upa-member-message"), err(error), "error");
    button.disabled = false;
  }
}

// ======================================================
// MODUL DATA KELOMPOK v1.5.0
// ======================================================

function groupUPAId() {
  return isAdminUtama()
    ? $("group-upa").value
    : assignedUPA?.id || "";
}

function getGroupUPAName(upaId) {
  const upa = upaCache.find(u => u.id === upaId);
  if (upa) return upa.namaUPA || "";
  if (assignedUPA?.id === upaId) return assignedUPA.namaUPA || "";
  return "";
}

function getActiveMembersForUPA(upaId) {
  const source = isAdminUtama() ? memberCache : adminUpaMemberCache;

  return source
    .filter(m => m.upaId === upaId && m.status === "active")
    .sort((a, b) => (a.nama || "").localeCompare(b.nama || "", "id"));
}

function getAllowedChildTypes(parentType) {
  if (parentType === "Muntazhim") return [...GROUP_TYPES];
  if (parentType === "Muntashib") return ["Muayyid", "Muhib", "Tamhidi"];
  return [];
}

function groupById(id) {
  return groupCache.find(g => g.id === id);
}

function fillSelect(select, placeholder, rows, labelFn, valueFn) {
  if (!select) return;

  const oldValue = select.value;
  select.replaceChildren(new Option(placeholder, ""));

  rows.forEach(row => {
    select.add(new Option(labelFn(row), valueFn(row)));
  });

  if ([...select.options].some(o => o.value === oldValue)) {
    select.value = oldValue;
  }
}

function refreshGroupUPASelector() {
  const select = $("group-upa");
  if (!select) return;

  if (isAdminUPA()) {
    select.replaceChildren(
      new Option(assignedUPA?.namaUPA || "UPA Anda", assignedUPA?.id || "")
    );
    select.value = assignedUPA?.id || "";
    select.disabled = true;
  } else {
    select.disabled = false;

    const active = upaCache
      .filter(u => u.status !== "inactive")
      .sort((a, b) => (a.namaUPA || "").localeCompare(b.namaUPA || "", "id"));

    fillSelect(
      select,
      "Pilih UPA",
      active,
      u => `${u.namaUPA || "UPA"} (${u.kodeUPA || "-"})`,
      u => u.id
    );
  }
}

function refreshGroupParentSelector() {
  const upaId = groupUPAId();
  const currentId = $("group-edit-id").value;
  const selectedType = $("group-type").value;

  const allowedParents = groupCache.filter(group => {
    if (group.status === "inactive") return false;
    if (group.upaId !== upaId) return false;
    if (group.id === currentId) return false;

    return getAllowedChildTypes(group.jenisKelompok)
      .includes(selectedType);
  });

  fillSelect(
    $("group-parent"),
    "Tanpa kelompok induk",
    allowedParents,
    g => `${g.namaKelompok} (${g.jenisKelompok})`,
    g => g.id
  );
}

function refreshGroupLeaderSelector() {
  const upaId = groupUPAId();
  const members = getActiveMembersForUPA(upaId);

  fillSelect(
    $("group-leader"),
    "Belum ditentukan",
    members,
    m => m.nama || "Anggota",
    m => m.id
  );
}

function refreshGroupMembershipMemberSelector() {
  const groupId = $("membership-group-id").value;
  const group = groupById(groupId);

  if (!group) {
    fillSelect($("membership-member"), "Pilih kelompok terlebih dahulu", [], () => "", () => "");
    return;
  }

  const activeMembers = getActiveMembersForUPA(group.upaId);
  const activeMembershipIds = new Set(
    groupMembershipCache
      .filter(m => m.groupId === groupId && m.status === "active")
      .map(m => m.memberId)
  );

  const available = activeMembers.filter(m => !activeMembershipIds.has(m.id));

  fillSelect(
    $("membership-member"),
    "Pilih anggota",
    available,
    m => m.nama || "Anggota",
    m => m.id
  );
}

function resetGroupForm() {
  $("group-form").reset();
  $("group-edit-id").value = "";
  $("group-form-title").textContent = "Tambah Kelompok";
  $("group-submit").textContent = "Simpan Kelompok";
  $("group-cancel").hidden = true;

  if (isAdminUPA() && assignedUPA) {
    $("group-upa").value = assignedUPA.id;
  }

  refreshGroupParentSelector();
  refreshGroupLeaderSelector();
}

$("group-cancel").onclick = resetGroupForm;
$("group-refresh").onclick = loadGroups;

$("group-type").onchange = () => {
  refreshGroupParentSelector();
};

$("group-upa").onchange = () => {
  refreshGroupParentSelector();
  refreshGroupLeaderSelector();
  renderGroups();
};

$("group-search").oninput = renderGroups;
$("group-filter-upa").onchange = renderGroups;
$("group-filter-type").onchange = renderGroups;
$("group-filter-status").onchange = renderGroups;

$("group-form").onsubmit = async event => {
  event.preventDefault();

  if (!canManageGroups() || busy) return;

  const button = $("group-submit");
  button.disabled = true;

  const id = $("group-edit-id").value;
  const upaId = groupUPAId();
  const name = $("group-name").value.trim();
  const type = $("group-type").value;
  const parentId = $("group-parent").value || "";
  const leaderId = $("group-leader").value || "";

  try {
    if (!name) throw new Error("Nama kelompok wajib diisi.");
    if (!GROUP_TYPES.includes(type)) throw new Error("Jenis kelompok tidak valid.");
    if (!upaId) throw new Error("Pilih UPA terlebih dahulu.");

    const upa = upaCache.find(u => u.id === upaId) ||
      (assignedUPA?.id === upaId ? assignedUPA : null);

    if (!upa || upa.status === "inactive") {
      throw new Error("UPA tidak ditemukan atau sedang tidak aktif.");
    }

    const parent = parentId ? groupById(parentId) : null;

    if (parentId) {
      if (!parent) throw new Error("Kelompok induk tidak ditemukan.");
      if (parent.upaId !== upaId) {
        throw new Error("Kelompok induk harus berasal dari UPA yang sama.");
      }
      if (parent.status === "inactive") {
        throw new Error("Kelompok induk sedang tidak aktif.");
      }
      if (!getAllowedChildTypes(parent.jenisKelompok).includes(type)) {
        throw new Error("Jenis kelompok anak tidak sesuai dengan hierarki.");
      }
      if (parent.id === id) {
        throw new Error("Kelompok tidak boleh menjadi induk bagi dirinya sendiri.");
      }

      // Mencegah siklus: telusuri rantai induk dari calon induk.
      let cursor = parent;
      const visited = new Set();

      while (cursor?.parentGroupId) {
        if (cursor.parentGroupId === id) {
          throw new Error("Hierarki tidak valid: akan membentuk siklus kelompok.");
        }
        if (visited.has(cursor.parentGroupId)) break;
        visited.add(cursor.parentGroupId);
        cursor = groupById(cursor.parentGroupId);
      }
    }

    const members = getActiveMembersForUPA(upaId);
    const leader = leaderId
      ? members.find(m => m.id === leaderId)
      : null;

    if (leaderId && !leader) {
      throw new Error("Ketua harus merupakan anggota aktif dari UPA yang sama.");
    }

    const data = {
      namaKelompok: name,
      jenisKelompok: type,
      parentGroupId: parentId,
      ketuaId: leaderId,
      namaKetua: leader?.nama || "",
      status: id
        ? (groupById(id)?.status || "active")
        : "active",
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    };

    if (id) {
      const existing = groupById(id);

      if (!existing || existing.upaId !== upaId) {
        throw new Error("Kelompok tidak ditemukan atau bukan bagian dari UPA ini.");
      }

      // UPA tidak diubah saat mengedit kelompok.
      await updateDoc(doc(db, "groups", id), data);

    } else {
      await addDoc(collection(db, "groups"), {
        ...data,
        upaId,
        namaUPA: upa.namaUPA || "",
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });
    }

    msg(
      $("group-message"),
      id ? "Data kelompok berhasil diperbarui." : "Kelompok berhasil ditambahkan.",
      "success"
    );

    resetGroupForm();
    await loadGroups();

  } catch (error) {
    console.error(error);
    msg($("group-message"), err(error), "error");
  } finally {
    button.disabled = false;
  }
};

async function loadGroups() {
  if (!canManageGroups()) return;

  const list = $("group-list");
  if (!list) return;

  list.replaceChildren();
  msg($("group-message"), "Memuat data kelompok...");

  try {
    let groupQuery;

    if (isAdminUtama()) {
      groupQuery = collection(db, "groups");
    } else {
      // Wajib memakai filter UPA karena Firestore Rules bukan filter data.
      groupQuery = query(
        collection(db, "groups"),
        where("upaId", "==", assignedUPA.id)
      );
    }

    const [groupsSnapshot, membersSnapshot] = await Promise.all([
      getDocs(groupQuery),
      isAdminUtama()
        ? getDocs(collection(db, "members"))
        : getDocs(query(
            collection(db, "members"),
            where("upaId", "==", assignedUPA.id)
          ))
    ]);

    groupCache = groupsSnapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    groupMemberCache = membersSnapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    let membershipQuery;

    if (isAdminUtama()) {
      membershipQuery = collection(db, "group_memberships");
    } else {
      membershipQuery = query(
        collection(db, "group_memberships"),
        where("upaId", "==", assignedUPA.id)
      );
    }

    const membershipSnapshot = await getDocs(membershipQuery);

    groupMembershipCache = membershipSnapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    $("group-count").textContent = groupCache.length + " kelompok";

    refreshGroupUPASelector();
    refreshGroupParentSelector();
    refreshGroupLeaderSelector();
    refreshGroupMembershipMemberSelector();
    renderGroups();

    msg($("group-message"), "");

  } catch (error) {
    console.error(error);
    msg($("group-message"), err(error), "error");
  }
}

function renderGroups() {
  const list = $("group-list");
  if (!list) return;

  list.replaceChildren();

  const term = $("group-search").value.trim().toLowerCase();
  const upaFilter = $("group-filter-upa").value;
  const typeFilter = $("group-filter-type").value;
  const statusFilter = $("group-filter-status").value;

  let rows = groupCache.filter(group => {
    const searchable = [
      group.namaKelompok,
      group.jenisKelompok,
      group.namaUPA,
      group.namaKetua
    ].join(" ").toLowerCase();

    return (!term || searchable.includes(term)) &&
      (!upaFilter || group.upaId === upaFilter) &&
      (!typeFilter || group.jenisKelompok === typeFilter) &&
      (!statusFilter || group.status === statusFilter);
  });

  rows.sort((a, b) =>
    (a.namaKelompok || "").localeCompare(b.namaKelompok || "", "id")
  );

  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = groupCache.length
      ? "Tidak ada kelompok yang sesuai dengan pencarian atau filter."
      : "Belum ada kelompok. Silakan tambahkan kelompok melalui formulir.";
    list.append(p);
    return;
  }

  rows.forEach(group => {
    const card = document.createElement("article");
    card.className = "item";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    const detail = document.createElement("p");
    const parent = document.createElement("p");
    const leader = document.createElement("p");
    const badge = document.createElement("span");

    title.textContent = group.namaKelompok || "Kelompok tanpa nama";

    detail.className = "muted";
    detail.textContent =
      `${group.jenisKelompok || "-"} • ${group.namaUPA || getGroupUPAName(group.upaId) || "UPA -"}`;

    const parentGroup = groupById(group.parentGroupId);
    parent.className = "muted";
    parent.textContent = "Induk: " +
      (parentGroup?.namaKelompok || "Tidak ada");

    leader.className = "muted";
    leader.textContent = "Ketua: " + (group.namaKetua || "Belum ditentukan");

    badge.className = "pill";
    badge.textContent = group.status || "active";

    info.append(title, detail, parent, leader, badge);

    const actions = document.createElement("div");
    actions.className = "actions";

    const edit = document.createElement("button");
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.onclick = () => editGroup(group);

    const membership = document.createElement("button");
    membership.className = "primary";
    membership.textContent = "Anggota Kelompok";
    membership.onclick = () => openGroupMembership(group);

    const toggle = document.createElement("button");
    toggle.className = "secondary";
    toggle.textContent = group.status === "inactive"
      ? "Aktifkan"
      : "Nonaktifkan";

    toggle.onclick = () =>
      toggleGroup(
        group.id,
        group.status === "inactive" ? "active" : "inactive",
        toggle
      );

    actions.append(edit, membership, toggle);
    card.append(info, actions);
    list.append(card);
  });
}

function editGroup(group) {
  if (!canManageGroups()) return;

  $("group-edit-id").value = group.id;
  $("group-name").value = group.namaKelompok || "";
  $("group-type").value = group.jenisKelompok || "";

  if (isAdminUtama()) {
    $("group-upa").value = group.upaId || "";
  } else {
    $("group-upa").value = assignedUPA?.id || "";
  }

  refreshGroupParentSelector();
  refreshGroupLeaderSelector();

  $("group-parent").value = group.parentGroupId || "";
  $("group-leader").value = group.ketuaId || "";

  $("group-form-title").textContent = "Edit Kelompok";
  $("group-submit").textContent = "Simpan perubahan";
  $("group-cancel").hidden = false;

  $("group-form").scrollIntoView({ behavior: "smooth" });
}

async function toggleGroup(id, status, button) {
  if (!canManageGroups()) return;

  if (!confirm(
    status === "inactive"
      ? "Nonaktifkan kelompok ini? Data dan riwayat keanggotaan tidak dihapus."
      : "Aktifkan kembali kelompok ini?"
  )) return;

  const group = groupById(id);

  if (!group || (isAdminUPA() && group.upaId !== assignedUPA.id)) {
    msg($("group-message"), "Akses ditolak untuk kelompok ini.", "error");
    return;
  }

  button.disabled = true;

  try {
    await updateDoc(doc(db, "groups", id), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    });

    await loadGroups();
    msg($("group-message"), "Status kelompok berhasil diubah.", "success");

  } catch (error) {
    console.error(error);
    msg($("group-message"), err(error), "error");
    button.disabled = false;
  }
}

// ======================================================
// KEANGGOTAAN KELOMPOK
// ======================================================

function openGroupMembership(group) {
  if (!canManageGroups()) return;

  if (isAdminUPA() && group.upaId !== assignedUPA?.id) {
    msg($("group-message"), "Kelompok bukan bagian dari UPA Anda.", "error");
    return;
  }

  $("group-membership-view").hidden = false;
  $("membership-group-id").value = group.id;
  $("membership-group-title").textContent =
    `Keanggotaan: ${group.namaKelompok} (${group.jenisKelompok})`;

  $("group-membership-form").reset();
  msg($("membership-message"), "");

  refreshGroupMembershipMemberSelector();
  renderGroupMemberships();

  $("group-membership-view").scrollIntoView({ behavior: "smooth" });
}

$("membership-group-id").onchange = () => {
  refreshGroupMembershipMemberSelector();
  renderGroupMemberships();
};

$("membership-close").onclick = () => {
  $("group-membership-view").hidden = true;
  $("membership-group-id").value = "";
};

$("group-membership-form").onsubmit = async event => {
  event.preventDefault();

  if (!canManageGroups() || busy) return;

  const button = $("membership-submit");
  button.disabled = true;

  const groupId = $("membership-group-id").value;
  const memberId = $("membership-member").value;
  const group = groupById(groupId);

  try {
    if (!group) throw new Error("Kelompok tidak ditemukan.");
    if (group.status === "inactive") {
      throw new Error("Kelompok sedang tidak aktif.");
    }

    if (isAdminUPA() && group.upaId !== assignedUPA?.id) {
      throw new Error("Kelompok bukan bagian dari UPA Anda.");
    }

    if (!memberId) throw new Error("Pilih anggota terlebih dahulu.");

    const member = getActiveMembersForUPA(group.upaId)
      .find(m => m.id === memberId);

    if (!member) {
      throw new Error("Anggota harus aktif dan berasal dari UPA yang sama.");
    }

    const duplicate = groupMembershipCache.some(m =>
      m.groupId === groupId &&
      m.memberId === memberId &&
      m.status === "active"
    );

    if (duplicate) {
      throw new Error("Anggota tersebut sudah terdaftar aktif pada kelompok ini.");
    }

    await addDoc(collection(db, "group_memberships"), {
      groupId,
      memberId,
      upaId: group.upaId,
      namaAnggota: member.nama || "",
      namaKelompok: group.namaKelompok || "",
      status: "active",
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    msg($("membership-message"), "Anggota berhasil dimasukkan ke kelompok.", "success");

    $("group-membership-form").reset();
    await loadGroups();

    // Kembalikan kelompok yang sedang dibuka setelah pemuatan ulang.
    $("membership-group-id").value = groupId;
    refreshGroupMembershipMemberSelector();
    renderGroupMemberships();

  } catch (error) {
    console.error(error);
    msg($("membership-message"), err(error), "error");
  } finally {
    button.disabled = false;
  }
};

function renderGroupMemberships() {
  const list = $("group-membership-list");
  if (!list) return;

  list.replaceChildren();

  const groupId = $("membership-group-id").value;
  const group = groupById(groupId);

  if (!group) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Pilih kelompok terlebih dahulu.";
    list.append(p);
    $("group-membership-count").textContent = "0 anggota";
    return;
  }

  const rows = groupMembershipCache
    .filter(m => m.groupId === groupId)
    .sort((a, b) =>
      (a.namaAnggota || "").localeCompare(b.namaAnggota || "", "id")
    );

  const activeCount = rows.filter(m => m.status === "active").length;
  $("group-membership-count").textContent =
    `${activeCount} anggota aktif • ${rows.length} seluruh data`;

  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Belum ada anggota dalam kelompok ini.";
    list.append(p);
    return;
  }

  rows.forEach(membership => {
    const member = groupMemberCache.find(m => m.id === membership.memberId);

    const card = document.createElement("article");
    card.className = "item";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    const detail = document.createElement("p");
    const badge = document.createElement("span");

    title.textContent =
      member?.nama || membership.namaAnggota || "Anggota tidak ditemukan";

    detail.className = "muted";
    detail.textContent = [
      member?.nomorHP,
      member?.email,
      member?.jabatan
    ].filter(Boolean).join(" • ") || "Kontak belum diisi";

    badge.className = "pill";
    badge.textContent = membership.status || "active";

    info.append(title, detail, badge);

    const actions = document.createElement("div");
    actions.className = "actions";

    const toggle = document.createElement("button");
    toggle.className = "secondary";
    toggle.textContent =
      membership.status === "inactive"
        ? "Aktifkan kembali"
        : "Nonaktifkan";

    toggle.onclick = () =>
      toggleGroupMembership(
        membership.id,
        membership.status === "inactive" ? "active" : "inactive",
        toggle
      );

    actions.append(toggle);
    card.append(info, actions);
    list.append(card);
  });
}

async function toggleGroupMembership(id, status, button) {
  if (!canManageGroups()) return;

  if (!confirm(
    status === "inactive"
      ? "Nonaktifkan keanggotaan ini? Riwayat tidak dihapus."
      : "Aktifkan kembali keanggotaan ini?"
  )) return;

  const membership = groupMembershipCache.find(m => m.id === id);

  if (!membership) {
    msg($("membership-message"), "Data keanggotaan tidak ditemukan.", "error");
    return;
  }

  if (isAdminUPA() && membership.upaId !== assignedUPA?.id) {
    msg($("membership-message"), "Akses ditolak. Data bukan bagian dari UPA Anda.", "error");
    return;
  }

  button.disabled = true;

  try {
    // Sesuai Rules: hanya status dan metadata pembaruan yang diubah.
    await updateDoc(doc(db, "group_memberships", id), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    });

    await loadGroups();

    msg($("membership-message"), "Status keanggotaan berhasil diubah.", "success");

  } catch (error) {
    console.error(error);
    msg($("membership-message"), err(error), "error");
    button.disabled = false;
  }
}

// ======================================================
// AKHIR APP.JS v1.5.0
// ======================================================
