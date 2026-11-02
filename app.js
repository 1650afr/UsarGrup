import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  doc, setDoc, serverTimestamp, getDoc, collection, query,
  where, getDocs, updateDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const authPanel = $("auth-panel");
const appPanel = $("app-panel");
const authMessage = $("auth-message");
let currentUser = null;
let actionBusy = false;

function message(target, text, kind = "") {
  target.textContent = text;
  target.className = kind;
}

function loginTab() {
  $("login-form").hidden = false;
  $("register-form").hidden = true;
  $("tab-login").classList.add("active");
  $("tab-register").classList.remove("active");
  message(authMessage, "");
}

$("tab-login").onclick = loginTab;
$("tab-register").onclick = () => {
  $("login-form").hidden = true;
  $("register-form").hidden = false;
  $("tab-login").classList.remove("active");
  $("tab-register").classList.add("active");
  message(authMessage, "");
};

$("login-form").onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  message(authMessage, "Sedang masuk...");
  try {
    await signInWithEmailAndPassword(
      auth, $("login-email").value.trim(), $("login-password").value
    );
    message(authMessage, "");
  } catch (error) {
    message(authMessage, errorText(error), "error");
  } finally {
    button.disabled = false;
  }
};

$("register-form").onsubmit = async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  message(authMessage, "Sedang membuat akun...");
  const name = $("register-name").value.trim();
  const email = $("register-email").value.trim();
  try {
    const credential = await createUserWithEmailAndPassword(
      auth, email, $("register-password").value
    );
    await updateProfile(credential.user, { displayName: name });
    await setDoc(doc(db, "users", credential.user.uid), {
      uid: credential.user.uid,
      displayName: name,
      email,
      status: "pending",
      requestedRole: "anggota",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    message(authMessage, "Pendaftaran berhasil. Akun menunggu verifikasi Admin Utama.", "success");
  } catch (error) {
    message(authMessage, errorText(error), "error");
  } finally {
    button.disabled = false;
  }
};

$("forgot-password").onclick = async () => {
  const email = $("login-email").value.trim();
  if (!email) {
    message(authMessage, "Isi email terlebih dahulu.", "error");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    message(authMessage, "Jika email terdaftar, tautan pengaturan ulang kata sandi akan dikirim.", "success");
  } catch (error) {
    message(authMessage, errorText(error), "error");
  }
};

$("logout-button").onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    appPanel.hidden = true;
    authPanel.hidden = false;
    loginTab();
    return;
  }

  authPanel.hidden = true;
  appPanel.hidden = false;
  $("welcome-title").textContent = "Assalamu'alaikum, " + (user.displayName || "Pengguna");
  $("user-email").textContent = user.email || "";
  hideAllViews();

  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!profileSnapshot.exists()) {
      showStatus("pending");
      return;
    }

    const profile = profileSnapshot.data();
    const role = profile.role || "anggota";
    const status = profile.status || "pending";

    if (role === "admin_utama" && status === "active") {
      $("admin-view").hidden = false;
      await loadPendingRegistrations();
    } else if (status === "active") {
      $("member-view").hidden = false;
    } else {
      showStatus(status);
    }
  } catch (error) {
    showStatus("pending");
    message($("admin-message"), errorText(error), "error");
  }
});

function hideAllViews() {
  ["pending-view", "rejected-view", "inactive-view", "admin-view", "member-view"]
    .forEach(id => $(id).hidden = true);
}

function showStatus(status) {
  const map = {
    pending: "pending-view",
    rejected: "rejected-view",
    inactive: "inactive-view"
  };
  const target = map[status] || "pending-view";
  $(target).hidden = false;
}

async function loadPendingRegistrations() {
  const list = $("pending-list");
  list.replaceChildren();
  message($("admin-message"), "Memuat daftar pendaftaran...");
  try {
    const pendingQuery = query(collection(db, "users"), where("status", "==", "pending"));
    const snapshot = await getDocs(pendingQuery);
    $("pending-count").textContent = `${snapshot.size} menunggu`;

    if (snapshot.empty) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Tidak ada pendaftaran yang menunggu verifikasi.";
      list.append(empty);
    } else {
      snapshot.forEach(userDoc => {
        const data = userDoc.data();
        const card = document.createElement("article");
        card.className = "pending-card";

        const info = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = data.displayName || "Nama belum diisi";
        const email = document.createElement("p");
        email.textContent = data.email || "Email tidak tersedia";
        email.className = "muted";
        const uid = document.createElement("small");
        uid.textContent = `ID: ${userDoc.id}`;
        uid.className = "muted uid";
        info.append(name, email, uid);

        const actions = document.createElement("div");
        actions.className = "actions";
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "approve";
        approve.textContent = "Setujui";
        approve.onclick = () => reviewRegistration(userDoc.id, "active", approve);
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "reject";
        reject.textContent = "Tolak";
        reject.onclick = () => reviewRegistration(userDoc.id, "rejected", reject);
        actions.append(approve, reject);
        card.append(info, actions);
        list.append(card);
      });
    }
    message($("admin-message"), "");
  } catch (error) {
    message($("admin-message"), errorText(error), "error");
  }
}

async function reviewRegistration(userId, newStatus, button) {
  if (!currentUser || actionBusy) return;
  const confirmation = newStatus === "active"
    ? "Setujui pendaftaran ini sebagai anggota biasa?"
    : "Tolak pendaftaran ini?";
  if (!window.confirm(confirmation)) return;

  actionBusy = true;
  button.disabled = true;
  message($("admin-message"), "Menyimpan keputusan...");
  try {
    await updateDoc(doc(db, "users", userId), {
      status: newStatus,
      role: "anggota",
      reviewedAt: serverTimestamp(),
      reviewedBy: currentUser.uid,
      updatedAt: serverTimestamp()
    });
    message($("admin-message"), newStatus === "active"
      ? "Pendaftaran berhasil disetujui."
      : "Pendaftaran telah ditolak.", "success");
    await loadPendingRegistrations();
  } catch (error) {
    message($("admin-message"), errorText(error), "error");
    button.disabled = false;
  } finally {
    actionBusy = false;
  }
}

function errorText(error) {
  const messages = {
    "auth/email-already-in-use": "Email sudah terdaftar. Silakan masuk.",
    "auth/invalid-email": "Format email tidak valid.",
    "auth/weak-password": "Gunakan kata sandi minimal 8 karakter.",
    "auth/invalid-credential": "Email atau kata sandi tidak sesuai.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
    "auth/network-request-failed": "Periksa koneksi internet.",
    "permission-denied": "Akses database ditolak. Periksa Firestore Security Rules.",
    "firestore/permission-denied": "Akses database ditolak. Periksa Firestore Security Rules."
  };
  return messages[error.code] || "Terjadi kendala: " + (error.message || error.code || "Kesalahan tidak diketahui.");
}
