// src/app.js
import {
  signInWithPopup,
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


// ---------- small helper to delete IndexedDB via Promise ----------
function deleteIndexedDb(dbName) {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onblocked = () => reject(new Error('delete blocked'));
      req.onerror = (ev) => reject(ev.target.error || new Error('delete error'));
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- app state ----------
(() => {
  const LS_KEY = 'notes-app-v1';
  let notes = [];
  let activeId = null;
  let currentUser = null;
  let signInInProgress = false;

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
      notes.sort((a,b) => (a.updated || 0) - (b.updated || 0));
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

  // ---------- Auth handlers ----------
  // SIGN IN: use redirect-only for better compatibility on GitHub Pages / with extensions
  if (btnSignIn) {
    btnSignIn.onclick = async () => {
      if (signInInProgress) return;
      signInInProgress = true;

      try {
        // If already signed in, do nothing
        if (auth.currentUser) {
          console.log("Already signed in:", auth.currentUser.uid);
          return;
        }

        console.log('SignIn click (redirect) debug:', { auth, provider });

        // Use redirect auth flow (less flaky than popup in many environments)
        try {
          await signInWithRedirect(auth, provider);
          // The page will navigate away to Google and back; onAuthStateChanged will handle the rest.
        } catch (err) {
          console.error('signInWithRedirect failed', err);
          // fallback: show user friendly message
          alert('Đăng nhập qua Google thất bại: ' + (err.message || err.code || 'Unknown error') + '\n' +
                'Thử mở trang ở chế độ ẩn danh hoặc tắt extensions / adblock.');
        }
      } finally {
        signInInProgress = false;
      }
    };
  }


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

      // Clear app UI state (local notes) but do NOT forcibly delete Firebase IndexedDB or reload.
      try {
        localStorage.removeItem('notes-app-v1');
        // keep firebase DB intact; deleting it can create weird reinit/redirect behaviour
      } catch (e) {
        console.warn('clear after signOut failed', e);
      }

      // Update UI immediately — onAuthStateChanged will also run and update UI accordingly.
      currentUser = null;
      if (btnSignIn) { btnSignIn.style.display = ''; btnSignIn.disabled = false; btnSignIn.textContent = 'Đăng nhập Google'; }
      if (btnSignOut) { btnSignOut.style.display = 'none'; }
      if (syncStatus) syncStatus.textContent = 'Offline';
      if (editor) editor.style.display = 'none';
      if (emptyState) emptyState.style.display = '';
      renderNotes();
    };
  }


  onAuthStateChanged(auth, async (user) => {
    console.log("onAuthStateChanged:", user?.uid ?? null);

    currentUser = user;

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

  (()=>{
    loadNotesLocal();
    if(notes.length === 0){
      notes.push({ id: uid(), title: 'Chào mừng!', content: 'Đây là ghi chú mẫu. Tạo ghi chú mới bằng nút + Ghi chú mới. Dữ liệu lưu cục bộ trong trình duyệt.', created: Date.now(), updated: Date.now() });
      saveNotesLocal();
    }
    renderNotes();
  })();

})(); // end IIFE
