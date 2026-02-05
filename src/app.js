// src/app.js
import {
  signInWithRedirect,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { auth, db, provider } from './lib/firebase.js';

// ---------- helpers ----------
const LS_KEY = 'notes-app-v1';
const el = id => document.getElementById(id);
const notesList = el('notesList');
const qInput = el('q');
const btnNew = el('btnNew');
const btnSave = el('btnSave');
const btnDelete = el('btnDelete');
const btnClearAll = el('btnClearAll');
const fileImport = el('fileImport');
const editor = el('editor');
const emptyState = el('emptyState');
const titleEl = el('title');
const contentEl = el('content');
const metaEl = el('meta');

const btnSignIn = el('btnSignIn');
const btnSignOut = el('btnSignOut');
const syncStatus = el('syncStatus');

let notes = [];
let activeId = null;
let currentUser = null;
let signInInProgress = false;

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6) }

function loadNotesLocal(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    notes = raw ? JSON.parse(raw) : [];
  } catch(e) {
    console.warn('loadNotesLocal parse error', e);
    notes = [];
  }
}
function saveNotesLocal(){ localStorage.setItem(LS_KEY, JSON.stringify(notes)); }

async function saveNoteToFirestore(note){
  if(!db || !currentUser) {
    console.warn('No db or user — skip cloud save');
    return false;
  }
  try {
    const payload = {
      title: note.title || '',
      content: note.content || '',
      created: note.created || Date.now(),
      updated: note.updated || Date.now(),
      userId: currentUser.uid,
      localId: note.id,
      createdAt: serverTimestamp()
    };

    if(note.firestoreId){
      const ref = doc(db, 'notes', note.firestoreId);
      await updateDoc(ref, payload);
    } else {
      const ref = await addDoc(collection(db, 'notes'), payload);
      note.firestoreId = ref.id;
      saveNotesLocal();
    }
    return true;
  } catch(e) {
    console.error('saveNoteToFirestore error', e);
    if(e && e.message && e.message.includes('requires an index')){
      alert('Lưu cloud thất bại: Firestore yêu cầu tạo index. Mở console để xem link tạo index trên Firebase Console.');
    } else if(e && e.code && e.code.startsWith('app/')) {
      alert('Lưu cloud thất bại do IndexedDB (trình duyệt). Thử Clear site data / dùng Incognito hoặc tắt extensions.');
    }
    return false;
  }
}

async function loadNotesFromFirestore(uid){
  if(!db) return false;
  try {
    const q = query(collection(db, 'notes'), where('userId','==', uid));
    const snap = await getDocs(q);
    notes = snap.docs.map(d => {
      const data = d.data();
      return {
        id: data.localId || d.id,
        title: data.title || '',
        content: data.content || '',
        created: data.created || data.createdAt || Date.now(),
        updated: data.updated || data.updatedAt || Date.now(),
        firestoreId: d.id
      };
    });
    // sort by updated desc
    notes.sort((a,b) => (b.updated || 0) - (a.updated || 0));
    saveNotesLocal();
    return true;
  } catch(e) {
    console.error('loadNotesFromFirestore error', e);
    if(e && e.message && e.message.includes('requires an index')) {
      alert('Firestore: Query requires a composite index. Check Firebase Console -> Indexes.');
    } else if(e && e.code && e.code.startsWith('app/')) {
      alert('Lỗi IndexedDB khi đọc Firestore. Thử Clear site data hoặc dùng Incognito (tắt extensions).');
    }
    return false;
  }
}

function escapeHtml(s){
  return (s+'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' })[c]);
}

function renderNotes(filter=''){
  if(!notesList) return;
  notesList.innerHTML = '';
  const f = (filter||'').trim().toLowerCase();
  const shown = notes.slice().filter(n => {
    if(!f) return true;
    return (n.title||'').toLowerCase().includes(f) || (n.content||'').toLowerCase().includes(f);
  });

  if(shown.length === 0){
    notesList.innerHTML = '<div class="empty">Chọn một ghi chú bên trái hoặc tạo mới để bắt đầu.</div>';
    return;
  }

  for(const n of shown){
    const elCard = document.createElement('div');
    elCard.className = 'note-card';
    elCard.innerHTML = `<strong>${escapeHtml(n.title||'Untitled')}</strong>
                        <small>${new Date(n.updated||n.created).toLocaleString()}</small>
                        <div style="margin-top:6px;color:var(--muted);font-size:13px">${escapeHtml((n.content||'').slice(0,120))}</div>`;
    elCard.onclick = ()=> openNote(n.id);
    notesList.appendChild(elCard);
  }
}

function findById(localId){ return notes.find(n => n.id === localId); }

function openNote(id){
  activeId = id;
  const n = findById(id);
  if(!n) return;
  if(titleEl) titleEl.value = n.title || '';
  if(contentEl) contentEl.value = n.content || '';
  if(metaEl) metaEl.textContent = `Tạo: ${new Date(n.created).toLocaleString()} • Cập nhật: ${new Date(n.updated||n.created).toLocaleString()}`;
  if(editor) editor.style.display = '';
  if(emptyState) emptyState.style.display = 'none';
}

function createNote(){
  const now = Date.now();
  const n = { id: uid(), title:'', content:'', created: now, updated: now, firestoreId: undefined };
  notes.unshift(n);
  saveNotesLocal();
  renderNotes(qInput ? qInput.value : '');
  openNote(n.id);
}

async function saveActiveNote(){
  if(!activeId) return;
  const n = findById(activeId);
  if(!n) return;
  if(titleEl) n.title = titleEl.value;
  if(contentEl) n.content = contentEl.value;
  n.updated = Date.now();
  // If notes list stored newest-first, update reorder
  notes = notes.filter(x=>x.id!==n.id);
  notes.unshift(n);
  saveNotesLocal();
  if(currentUser){
    const ok = await saveNoteToFirestore(n);
    if(syncStatus) syncStatus.textContent = ok ? 'Đồng bộ (cloud)' : 'Lỗi đồng bộ';
  }
  renderNotes(qInput ? qInput.value : '');
  if(metaEl) metaEl.textContent = `Tạo: ${new Date(n.created).toLocaleString()} • Cập nhật: ${new Date(n.updated).toLocaleString()}`;
  if(btnSave){
    btnSave.textContent = 'Đã lưu';
    setTimeout(()=> btnSave.textContent = 'Lưu', 700);
  }
}

function deleteActiveNote(){
  if(!activeId) return;
  if(!confirm('Xác nhận xóa ghi chú này?')) return;
  notes = notes.filter(x => x.id !== activeId);
  saveNotesLocal();
  activeId = null;
  if(editor) editor.style.display = 'none';
  if(emptyState) emptyState.style.display = '';
  renderNotes(qInput ? qInput.value : '');
}

function clearAll(){
  if(!confirm('Xóa tất cả ghi chú? Hành động không thể hoàn tác.')) return;
  notes = [];
  saveNotesLocal();
  activeId = null;
  if(editor) editor.style.display = 'none';
  if(emptyState) emptyState.style.display = '';
  renderNotes();
}

function importJson(file){
  const r = new FileReader();
  r.onload = ()=>{
    try {
      const parsed = JSON.parse(r.result);
      if(Array.isArray(parsed)){
        const existingIds = new Set(notes.map(n=>n.id));
        for(const it of parsed){
          if(!it.id) it.id = uid();
          if(existingIds.has(it.id)) it.id = uid();
          notes.unshift({
            id: it.id,
            title: it.title || '',
            content: it.content || '',
            created: it.created || Date.now(),
            updated: it.updated || it.created || Date.now()
          });
        }
        saveNotesLocal();
        renderNotes();
        alert('Nhập thành công');
      } else {
        alert('Tập tin không chứa mảng ghi chú');
      }
    } catch(e){
      alert('Không thể đọc file: ' + e.message);
    }
  };
  r.readAsText(file);
}

// ---------- Persistence UI helper ----------
function updatePersistenceStatusUI() {
  if(!syncStatus) return;
  const p = (window.__MYNOTES_FB && window.__MYNOTES_FB.persistence) || 'unknown';
  if (p === 'local') {
    syncStatus.textContent = 'Đồng bộ (cloud)';
  } else if (p === 'session') {
    syncStatus.textContent = 'Đồng bộ (cloud - session)';
  } else if (p === 'memory') {
    syncStatus.textContent = 'Offline (memory persistence)';
  } else if (p === 'none') {
    syncStatus.textContent = 'Không hỗ trợ storage';
  } else {
    syncStatus.textContent = 'Offline';
  }
}

// Poll for persistence flag if firebase sets it slightly later
function pollPersistenceUI() {
  updatePersistenceStatusUI();
  // if not ready, check again a couple times
  if(!(window.__MYNOTES_FB && window.__MYNOTES_FB.persistence)) {
    setTimeout(() => {
      updatePersistenceStatusUI();
    }, 500);
    setTimeout(() => {
      updatePersistenceStatusUI();
    }, 2000);
  }
}

// ---------- Auth UI handlers ----------

// Sign in: redirect-only (more reliable on GitHub Pages + extensions)
// robust signin handler: try popup first, fallback to redirect, show friendly timeout hint
if (btnSignIn) {
  btnSignIn.onclick = async () => {
    if (signInInProgress) return;
    signInInProgress = true;

    const origText = btnSignIn.textContent;
    btnSignIn.textContent = 'Đang mở đăng nhập...';
    btnSignIn.disabled = true;

    // helper to show hint to user
    function showSignInHint() {
      let info = document.getElementById('signInInfo');
      if (!info) {
        info = document.createElement('div');
        info.id = 'signInInfo';
        info.style.marginTop = '8px';
        info.style.fontSize = '13px';
        info.style.color = 'var(--muted)';
        // append near buttons if possible
        const container = btnSignIn.parentElement || document.body;
        container.appendChild(info);
      }
      info.innerHTML = `
        Nếu trang đăng nhập không mở, thử:
        <ul>
          <li>Mở trang trong cửa sổ ẩn danh (không có extensions)</li>
          <li>Tắt tạm extensions (adblock/privacy)</li>
          <li>Hoặc thử đăng nhập trên tab/chrome khác</li>
        </ul>
      `;
    }

    // set a fallback timer: if nothing happened in 3s, show hint
    const hintTimer = setTimeout(() => {
      showSignInHint();
    }, 3000);

    try {
      console.log('SignIn click (try popup) debug:', { auth, provider });

      // try popup first — often best UX. If this throws with popup-blocked or COOP problems, fallback below.
      try {
        // dynamic import to reuse same firebase auth module (optional)
        // using popup may throw different codes depending on environment.
        await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js")
          .then(mod => mod.signInWithPopup(auth, provider));
        console.log('signInWithPopup ok');
        return;
      } catch (popupErr) {
        console.warn('signInWithPopup failed, will fallback to redirect. err:', popupErr?.code || popupErr?.message || popupErr);
        // decide fallback is appropriate for common popup/COOP errors
        const msg = (popupErr && (popupErr.message || '')).toString();
        if (!/popup-closed-by-user|cancelled-popup-request/i.test(popupErr?.code || '')) {
          // try redirect fallback
          try {
            console.log('Falling back to signInWithRedirect');
            await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js")
              .then(mod => mod.signInWithRedirect(auth, provider));
            // if redirect started browser will navigate away; code here will not continue.
            return;
          } catch (redirErr) {
            console.error('signInWithRedirect failed as fallback:', redirErr);
            alert('Đăng nhập thất bại: ' + (redirErr.message || redirErr.code || 'Unknown error') +
                  '\nThử mở trang ở chế độ ẩn danh hoặc tắt extensions.');
            return;
          }
        } else {
          // user closed popup intentionally - don't fallback automatically
          console.log('Popup was closed/cancelled by user.');
          return;
        }
      }
    } finally {
      clearTimeout(hintTimer);
      // restore UI (if we didn't actually navigate away)
      btnSignIn.textContent = origText;
      btnSignIn.disabled = false;
      signInInProgress = false;
    }
  };
}

// Sign out: don't delete firebase indexed DB automatically (can create weird state)
if (btnSignOut) {
  btnSignOut.onclick = async () => {
    try {
      await signOut(auth);
      console.log('Signed out.');
    } catch (e) {
      console.error('signOut error', e);
      alert('Lỗi khi đăng xuất: ' + (e.message || e.code));
      return;
    }

    // Clear app UI state + local notes; don't delete Firebase IndexedDB automatically.
    try {
      localStorage.removeItem(LS_KEY);
    } catch (e) {
      console.warn('clear after signOut failed', e);
    }

    // update UI right away
    currentUser = null;
    if (btnSignIn) { btnSignIn.style.display = ''; btnSignIn.disabled = false; btnSignIn.textContent = 'Đăng nhập Google'; }
    if (btnSignOut) { btnSignOut.style.display = 'none'; }
    if (syncStatus) syncStatus.textContent = 'Offline';
    if (editor) editor.style.display = 'none';
    if (emptyState) emptyState.style.display = '';
    renderNotes();
  };
}

// ---------- onAuthStateChanged ----------
onAuthStateChanged(auth, async (user) => {
  console.log("onAuthStateChanged:", user?.uid ?? null);
  currentUser = user;

  // update persistence UI if we know it
  pollPersistenceUI();

  if (btnSignIn) {
    btnSignIn.style.display = user ? 'none' : '';
    btnSignIn.disabled = !!user;
    btnSignIn.textContent = user ? 'Đã đăng nhập' : 'Đăng nhập Google';
  }
  if (btnSignOut) {
    btnSignOut.style.display = user ? '' : 'none';
  }
  if (syncStatus) {
    syncStatus.textContent = user ? 'Đang đồng bộ...' : 'Offline';
  }

  loadNotesLocal();

  if (user) {
    try {
      const ok = await loadNotesFromFirestore(user.uid);
      if (syncStatus) {
        syncStatus.textContent = ok ? 'Đồng bộ (cloud)' : 'Lỗi đồng bộ, dùng local';
      }
    } catch (err) {
      console.error('Firestore sync error:', err);
      if (syncStatus) syncStatus.textContent = 'Lỗi đồng bộ, dùng local';
    }
  }

  renderNotes(qInput ? qInput.value : '');
});

// ---------- Events ----------
if(btnNew) btnNew.onclick = createNote;
if(btnSave) btnSave.onclick = ()=>{ if(!activeId) createNote(); saveActiveNote(); };
if(btnDelete) btnDelete.onclick = deleteActiveNote;
if(btnClearAll) btnClearAll.onclick = clearAll;
if(fileImport) fileImport.onchange = e => { const f = e.target.files && e.target.files[0]; if(f) importJson(f); fileImport.value = '' };
if(qInput) qInput.oninput = ()=> renderNotes(qInput.value);

const keyHandler = (e) => {
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n'){ e.preventDefault(); createNote(); }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveActiveNote(); }
};
if(typeof globalThis.addEventListener === 'function') globalThis.addEventListener('keydown', keyHandler);
else if(typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('keydown', keyHandler);

// ---------- Initial bootstrap ----------
(function bootstrap(){
  loadNotesLocal();
  if(notes.length === 0){
    notes.push({ id: uid(), title: 'Chào mừng!', content: 'Đây là ghi chú mẫu. Tạo ghi chú mới bằng nút + Ghi chú mới. Dữ liệu lưu cục bộ trong trình duyệt.', created: Date.now(), updated: Date.now() });
    saveNotesLocal();
  }
  renderNotes();
  // Try to show persistence status early
  pollPersistenceUI();
})();
