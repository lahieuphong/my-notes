// src/app.js (type="module")
// FULL app.js — dùng cùng phiên bản SDK với src/lib/firebase.js (10.7.1)
import { signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { auth, db, provider } from './lib/firebase.js';

(() => {
  const LS_KEY = 'notes-app-v1';
  let notes = [];
  let activeId = null;
  let currentUser = null;

  // Elements (giữ nguyên id như trong index.html)
  const notesList = document.getElementById('notesList');
  const qInput = document.getElementById('q');
  const btnNew = document.getElementById('btnNew');
  const btnSave = document.getElementById('btnSave');
  const btnDelete = document.getElementById('btnDelete');
  const btnClearAll = document.getElementById('btnClearAll');
  const fileImport = document.getElementById('fileImport');
  const editor = document.getElementById('editor');
  const emptyState = document.getElementById('emptyState');
  const titleEl = document.getElementById('title');
  const contentEl = document.getElementById('content');
  const metaEl = document.getElementById('meta');

  const btnSignIn = document.getElementById('btnSignIn');
  const btnSignOut = document.getElementById('btnSignOut');
  const syncStatus = document.getElementById('syncStatus');

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6) }

  // ---------- Local storage helpers ----------
  function loadNotesLocal(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      notes = raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('loadNotesLocal parse error', e);
      notes = [];
    }
  }
  function saveNotesLocal(){ localStorage.setItem(LS_KEY, JSON.stringify(notes)); }

  // ---------- Firestore helpers ----------
  async function saveNoteToFirestore(note){
    if(!db || !currentUser){
      console.warn('No db or user — skip cloud save');
      return false;
    }
    try{
      const payload = {
        title: note.title || '',
        content: note.content || '',
        created: note.created || Date.now(),
        updated: note.updated || Date.now(),
        userId: currentUser.uid,
        createdAt: serverTimestamp()
      };
      const docRef = await addDoc(collection(db, 'notes'), payload);
      console.log('Saved note to firestore, id=', docRef.id);
      return true;
    }catch(e){
      console.error('saveNoteToFirestore error', e);
      // if it's an index error, the developer console will show a link
      if(e && e.message && e.message.includes('requires an index')){
        // extract link if present
        const match = e.message.match(/(https?:\/\/[^\s)]+)/);
        if(match) console.info('Create index here:', match[1]);
        alert('Lưu cloud thất bại: Firestore yêu cầu tạo index. Kiểm tra console để mở link tạo index.');
      }
      return false;
    }
  }

  async function loadNotesFromFirestore(uid){
    if(!db) return false;
    try{
      // Query: where userId == uid and order by updated asc
      const q = query(collection(db, 'notes'), where('userId', '==', uid), orderBy('updated', 'asc'));
      const snap = await getDocs(q);
      notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      saveNotesLocal();
      console.log('Loaded notes from firestore, count=', notes.length);
      return true;
    }catch(e){
      console.error('loadNotesFromFirestore error', e);
      if(e && e.message && e.message.includes('requires an index')){
        // show friendly hint: console also contains full link
        const match = e.message.match(/(https?:\/\/[^\s)]+)/);
        if(match) {
          const link = match[1];
          console.info('Firestore requires composite index. Create it here:', link);
          alert('Firestore: Query requires a composite index. Mở console để click link tạo index hoặc copy-paste link kiểm soát.');
        } else {
          alert('Firestore: Query requires a composite index. Mở Firebase Console -> Indexes để tạo.');
        }
      }
      return false;
    }
  }

  // ---------- Utilities ----------
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

    if(shown.length===0){
      notesList.innerHTML = '<div class="empty">Không có ghi chú nào.</div>';
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

  function openNote(id){
    activeId = id;
    const n = notes.find(x=>x.id===id);
    if(!n) return;
    titleEl.value = n.title||'';
    contentEl.value = n.content||'';
    metaEl.textContent = `Tạo: ${new Date(n.created).toLocaleString()} • Cập nhật: ${new Date(n.updated||n.created).toLocaleString()}`;
    editor.style.display = '';
    emptyState.style.display = 'none';
  }

  function createNote(){
    const now = Date.now();
    const n = { id: uid(), title:'', content:'', created: now, updated: now };
    notes.push(n);
    saveNotesLocal();
    renderNotes(qInput.value);
    openNote(n.id);
  }

  async function saveActiveNote(){
    if(!activeId) return;
    const n = notes.find(x=>x.id===activeId);
    if(!n) return;
    n.title = titleEl.value;
    n.content = contentEl.value;
    n.updated = Date.now();
    saveNotesLocal();
    if(currentUser){
      const ok = await saveNoteToFirestore(n);
      syncStatus.textContent = ok ? 'Đồng bộ (cloud)' : 'Lỗi đồng bộ';
    }
    renderNotes(qInput.value);
    metaEl.textContent = `Tạo: ${new Date(n.created).toLocaleString()} • Cập nhật: ${new Date(n.updated).toLocaleString()}`;
    btnSave.textContent = 'Đã lưu';
    setTimeout(()=> btnSave.textContent = 'Lưu', 700);
  }

  function deleteActiveNote(){
    if(!activeId) return;
    if(!confirm('Xác nhận xóa ghi chú này?')) return;
    notes = notes.filter(x=>x.id!==activeId);
    saveNotesLocal();
    activeId = null;
    editor.style.display = 'none';
    emptyState.style.display = '';
    renderNotes(qInput.value);
  }

  function clearAll(){
    if(!confirm('Xóa tất cả ghi chú? Hành động không thể hoàn tác.')) return;
    notes = [];
    saveNotesLocal();
    activeId = null;
    editor.style.display = 'none';
    emptyState.style.display = '';
    renderNotes();
  }

  function importJson(file){
    const r = new FileReader();
    r.onload = ()=>{
      try{
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
          renderNotes(); alert('Nhập thành công');
        } else {
          alert('Tập tin không chứa mảng ghi chú');
        }
      }catch(e){
        alert('Không thể đọc file: ' + e.message);
      }
    };
    r.readAsText(file);
  }

  // ---------- Auth handlers (with fallback) ----------
  btnSignIn.onclick = async ()=>{
    if(!auth){
      alert('Firebase chưa được cấu hình. Vui lòng kiểm tra src/lib/firebase.js');
      return;
    }
    try{
      await signInWithPopup(auth, provider);
      console.log('signInWithPopup succeeded (popup).');
    }catch(e){
      console.error('signInWithPopup error', e);
      // nếu popup bị block hoặc internal failure -> thử redirect fallback
      const popupBlocked = e && (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request' || e.code === 'auth/internal-error');
      if(popupBlocked){
        try {
          console.log('Popup blocked — trying signInWithRedirect fallback');
          await signInWithRedirect(auth, provider);
          return;
        } catch(e2){
          console.error('signInWithRedirect failed', e2);
        }
      }
      // nếu unauthorized-domain / operation-not-allowed, thông báo rõ
      let hint = '';
      if(e && e.code === 'auth/unauthorized-domain') hint = '\n\nLỗi: unauthorized-domain — thêm domain vào Firebase Console -> Authentication -> Authorized domains.';
      if(e && e.code === 'auth/operation-not-allowed') hint = '\n\nLỗi: operation-not-allowed — bật Google provider trong Firebase Console -> Authentication -> Sign-in method.';
      alert('Đăng nhập thất bại: ' + (e.message || e.code || e) + hint);
    }
  };

  btnSignOut.onclick = async ()=>{
    if(!auth) return;
    try{
      await signOut(auth);
      console.log('Signed out.');
    }catch(e){
      console.error('signOut error', e);
    }
  };

  onAuthStateChanged(auth, async (user)=>{
    currentUser = user;
    console.log('onAuthStateChanged:', user ? user.uid : null);
    if(user){
      btnSignIn.style.display = 'none';
      btnSignOut.style.display = '';
      syncStatus.textContent = 'Đang đồng bộ...';
      loadNotesLocal();
      const ok = await loadNotesFromFirestore(user.uid);
      syncStatus.textContent = ok ? 'Đồng bộ (cloud)' : 'Lỗi đồng bộ, dùng local';
    }else{
      btnSignIn.style.display = '';
      btnSignOut.style.display = 'none';
      syncStatus.textContent = 'Offline';
      loadNotesLocal();
    }
    renderNotes(qInput.value);
  });

  // ---------- Events ----------
  btnNew.onclick = createNote;
  btnSave.onclick = ()=>{ if(!activeId) createNote(); saveActiveNote(); };
  btnDelete.onclick = deleteActiveNote;
  btnClearAll.onclick = clearAll;
  fileImport.onchange = e=>{ const f = e.target.files && e.target.files[0]; if(f) importJson(f); fileImport.value = '' };
  qInput.oninput = ()=> renderNotes(qInput.value);

  // Use globalThis.addEventListener to avoid possible window shadowing by extensions
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('keydown', (e)=>{
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n'){ e.preventDefault(); createNote(); }
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveActiveNote(); }
    });
  } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', (e)=>{
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n'){ e.preventDefault(); createNote(); }
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveActiveNote(); }
    });
  }

  // ---------- init ----------
  (()=>{
    loadNotesLocal();
    if(notes.length===0){
      notes.push({id:uid(),title:'Chào mừng!',content:'Đây là ghi chú mẫu. Tạo ghi chú mới bằng nút + Ghi chú mới. Dữ liệu lưu cục bộ trong trình duyệt.',created:Date.now(),updated:Date.now()});
      saveNotesLocal();
    }
    renderNotes();
  })();

})();
