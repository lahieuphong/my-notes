// src/app.js (type="module")
// Full app logic: local + firestore sync, robust auth, index hint, avoids SDK mixups
import { signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { auth, db, provider } from './lib/firebase.js';

(() => {
  const LS_KEY = 'notes-app-v1';
  let notes = []; // each note: { id: localId, title, content, created, updated, firestoreId? }
  let activeId = null;
  let currentUser = null;
  let signInInProgress = false;

  // Elements (if any missing, script will not fail)
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

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6) }

  // ---------- Local helpers ----------
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

  // ---------- Firestore helpers ----------
  // Save or update a single note: if it has firestoreId -> update, else add
  async function saveNoteToFirestore(note){
    if(!db || !currentUser) {
      console.warn('No db or user — skip cloud save');
      return false;
    }
    try {
      // payload includes localId so we can correlate later
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
        console.log('Updated note on firestore:', note.firestoreId);
      } else {
        const ref = await addDoc(collection(db, 'notes'), payload);
        note.firestoreId = ref.id; // save mapping locally
        saveNotesLocal(); // persist mapping
        console.log('Added note to firestore:', ref.id);
      }
      return true;
    } catch(e) {
      console.error('saveNoteToFirestore error', e);
      if(e && e.message && e.message.includes('requires an index')){
        const match = e.message.match(/(https?:\/\/[^\s)]+)/);
        if(match) console.info('Create index here:', match[1]);
        alert('Lưu cloud thất bại: Firestore yêu cầu tạo index. Mở console để click link tạo index hoặc vào Firebase Console > Indexes.');
      } else if(e && e.code && e.code.startsWith('app/')) {
        // IndexedDB errors often surface as app/idb-set etc
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

      // sort client-side by updated ascending
      notes.sort((a,b) => (a.updated || 0) - (b.updated || 0));
      saveNotesLocal();
      console.log('Loaded notes from firestore, count=', notes.length);
      return true;
    } catch(e) {
      console.error('loadNotesFromFirestore error', e);
      if(e && e.message && e.message.includes('requires an index')) {
        const match = e.message.match(/(https?:\/\/[^\s)]+)/);
        if(match) {
          console.info('Create index here:', match[1]);
          alert('Firestore: Query requires a composite index. Mở console để click link tạo index hoặc vào Firebase Console -> Indexes.');
        } else {
          alert('Firestore: Query requires a composite index. Đi tới Firebase Console -> Indexes để tạo.');
        }
      } else if(e && e.code && e.code.startsWith('app/')) {
        alert('Lỗi IndexedDB khi đọc Firestore. Thử Clear site data hoặc dùng Incognito (tắt extensions).');
      }
      return false;
    }
  }

  // ---------- UI utilities ----------
  function escapeHtml(s){
    return (s+'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' })[c]);
  }

  function renderNotes(filter=''){
    if(!notesList) return;
    notesList.innerHTML = '';
    const f = (filter||'').trim().toLowerCase();
    const shown = notes.slice().reverse().filter(n => {
      if(!f) return true;
      return (n.title||'').toLowerCase().includes(f) || (n.content||'').toLowerCase().includes(f);
    });

    if(shown.length === 0){
      notesList.innerHTML = '<div class="empty">Chọn một ghi chú bên trái hoặc tạo mới để bắt đầu.</div>';
      return;
    }

    for(const n of shown){
      const el = document.createElement('div');
      el.className = 'note-card';
      el.innerHTML = `<strong>${escapeHtml(n.title||'Untitled')}</strong>
                      <small>${new Date(n.updated||n.created).toLocaleString()}</small>
                      <div style="margin-top:6px;color:var(--muted);font-size:13px">${escapeHtml((n.content||'').slice(0,120))}</div>`;
      el.onclick = ()=> openNote(n.id);
      notesList.appendChild(el);
    }
  }

  function findById(localId){
    return notes.find(n => n.id === localId);
  }

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
    notes.push(n);
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
    saveNotesLocal();
    // cloud save only if logged in
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
    // NOTE: we don't delete from Firestore automatically. Could add removal if desired.
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
            notes.push({
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

  // ---------- Auth handlers (robust) ----------
  // helper to detect production -> use redirect there
  const useRedirectByDefault = () => {
    try {
      const host = location.hostname;
      return host !== 'localhost' && host !== '127.0.0.1';
    } catch(e) {
      return true;
    }
  };
  
  if(btnSignIn){
    btnSignIn.onclick = async () => {
      const auth = getAuth();

      // 🔒 ĐANG LOGIN RỒI → KHÔNG GỌI signInWithPopup
      if (auth.currentUser) {
        console.log("Already signed in:", auth.currentUser.uid);
        return;
      }

      try {
        console.log("SignIn click debug:", auth, provider);
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.error("Sign-in error (popup):", err);
        alert("Đăng nhập thất bại: " + err.code);
      }
    };
  }

  if(btnSignOut){
    btnSignOut.onclick = async () => {
      try {
        await signOut(auth);
        console.log('Signed out.');
      } catch(e){
        console.error('signOut error', e);
      }
    };
  }

  // Auth state listener
  onAuthStateChanged(auth, async (user) => {
    console.log("onAuthStateChanged:", user?.uid ?? null);

    currentUser = user;

    // ===== UI: Login / Logout =====
    if (btnSignIn) {
      btnSignIn.style.display = user ? 'none' : '';
      btnSignIn.disabled = !!user;
      btnSignIn.textContent = user ? 'Đã đăng nhập' : 'Đăng nhập Google';
    }

    if (btnSignOut) {
      btnSignOut.style.display = user ? '' : 'none';
    }

    // ===== Sync status =====
    if (syncStatus) {
      syncStatus.textContent = user ? 'Đang đồng bộ...' : 'Offline';
    }

    // ===== Data loading =====
    loadNotesLocal();

    if (user) {
      try {
        const ok = await loadNotesFromFirestore(user.uid);
        if (syncStatus) {
          syncStatus.textContent = ok
            ? 'Đồng bộ (cloud)'
            : 'Lỗi đồng bộ, dùng local';
        }
      } catch (err) {
        console.error('Firestore sync error:', err);
        if (syncStatus) {
          syncStatus.textContent = 'Lỗi đồng bộ, dùng local';
        }
      }
    }

    // ===== Render =====
    renderNotes(qInput ? qInput.value : '');
  });

  // ---------- Events ----------
  if(btnNew) btnNew.onclick = createNote;
  if(btnSave) btnSave.onclick = ()=>{ if(!activeId) createNote(); saveActiveNote(); };
  if(btnDelete) btnDelete.onclick = deleteActiveNote;
  if(btnClearAll) btnClearAll.onclick = clearAll;
  if(fileImport) fileImport.onchange = e => { const f = e.target.files && e.target.files[0]; if(f) importJson(f); fileImport.value = '' };
  if(qInput) qInput.oninput = ()=> renderNotes(qInput.value);

  // global keyboard shortcuts (use globalThis to avoid extension shadowing)
  const keyHandler = (e) => {
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n'){ e.preventDefault(); createNote(); }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveActiveNote(); }
  };
  if(typeof globalThis.addEventListener === 'function') globalThis.addEventListener('keydown', keyHandler);
  else if(typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('keydown', keyHandler);

  // ---------- init ----------
  (()=>{
    loadNotesLocal();
    if(notes.length === 0){
      notes.push({ id: uid(), title: 'Chào mừng!', content: 'Đây là ghi chú mẫu. Tạo ghi chú mới bằng nút + Ghi chú mới. Dữ liệu lưu cục bộ trong trình duyệt.', created: Date.now(), updated: Date.now() });
      saveNotesLocal();
    }
    renderNotes();
  })();

})();
