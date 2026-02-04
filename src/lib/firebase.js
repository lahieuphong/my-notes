// app.js (type="module")
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

(() => {
  // ----------------- PASTE FIREBASE CONFIG OBJECT FROM CONSOLE HERE -----------------
  const FIREBASE_CONFIG = {
        apiKey: "AIzaSyDTKsCF7EDnQlUfw1i4sMz1YKq30viz-Do",
        authDomain: "my-notes-lahieuphong.firebaseapp.com",
        projectId: "my-notes-lahieuphong",
        storageBucket: "my-notes-lahieuphong.firebasestorage.app",
        messagingSenderId: "714744608587",
        appId: "1:714744608587:web:330b6994a5750272521ace",
        measurementId: "G-SDHCXVXED7"
  };
  // ----------------------------------------------------------------------------------

  // If user forgot to paste, app will still run with localStorage fallback.
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.projectId) {
    console.warn('Firebase config not provided — app will run local-only until config is added.');
  }

  // Initialize Firebase only if config present
  let app = null, auth = null, db = null;
  if (FIREBASE_CONFIG && FIREBASE_CONFIG.projectId) {
    app = initializeApp(FIREBASE_CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);
  }

  const provider = new GoogleAuthProvider();

  const LS_KEY = 'notes-app-v1'
  let notes = []
  let activeId = null
  let currentUser = null

  // Elements
  const notesList = document.getElementById('notesList')
  const qInput = document.getElementById('q')
  const btnNew = document.getElementById('btnNew')
  const btnSave = document.getElementById('btnSave')
  const btnDelete = document.getElementById('btnDelete')
  const btnClearAll = document.getElementById('btnClearAll')
  const fileImport = document.getElementById('fileImport')
  const editor = document.getElementById('editor')
  const emptyState = document.getElementById('emptyState')
  const titleEl = document.getElementById('title')
  const contentEl = document.getElementById('content')
  const metaEl = document.getElementById('meta')

  // Sync UI
  const btnSignIn = document.getElementById('btnSignIn')
  const btnSignOut = document.getElementById('btnSignOut')
  const syncStatus = document.getElementById('syncStatus')

  function uid(){return Date.now().toString(36) + Math.random().toString(36).slice(2,6)}

  // ---------------- Local storage helpers ----------------
  function loadNotesLocal(){
    try{
      const raw = localStorage.getItem(LS_KEY)
      notes = raw ? JSON.parse(raw) : []
    }catch(e){ notes = [] }
  }
  function saveNotesLocal(){ localStorage.setItem(LS_KEY, JSON.stringify(notes)) }

  // ---------------- Remote helpers (Firestore) ----------------

  // === LƯU NOTE MỚI VÀO COLLECTION 'notes' (THEO YÊU CẦU) ===
  async function saveNoteToFirestore(note){
    if(!db || !currentUser) return;
    try{
      await addDoc(collection(db, 'notes'), {
        title: note.title,
        content: note.content,
        created: note.created,
        updated: note.updated,
        userId: currentUser.uid,
        createdAt: serverTimestamp(),
      });
      // Không ép cập nhật local id -> chúng ta dùng Firestore doc id khi load later
      return true;
    }catch(e){
      console.error('saveNoteToFirestore error', e)
      return false;
    }
  }

  // === LOAD NOTES THEO USER TỪ COLLECTION 'notes' ===
  async function loadNotesFromFirestore(uid){
    if(!db) return;
    try{
      const q = query(
        collection(db, 'notes'),
        where('userId', '==', uid),
        orderBy('updated', 'asc')
      );

      const snap = await getDocs(q);
      notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // ensure numeric timestamps (Firestore may return Timestamp objects if used) --
      // but we'll just persist whatever came from Firestore and save locally.
      saveNotesLocal();
      return true;
    }catch(e){
      console.error('loadNotesFromFirestore error', e)
      return false;
    }
  }

  // ---------------- OLD REMOTE HELPERS (KEPT FOR REFERENCE BUT NOT USED) ----------------
  // As requested: do not delete these functions but stop using them.
  async function loadNotesRemote(uid){
    // ORIGINAL: load notes from 'users' doc and merge with local
    // Kept here for reference only — this function is no longer invoked.
    if(!db) return false
    try{
      const ref = doc(db, 'users', uid)
      const snap = await getDoc(ref)
      if(snap.exists()){
        const data = snap.data()
        const remoteNotes = Array.isArray(data.notes) ? data.notes : []
        // Merge remote and local (keep newest by updated timestamp)
        notes = mergeNotes(notes, remoteNotes)
        saveNotesLocal()
        return true
      }else{
        // No doc yet: create doc with local notes (if any)
        await setDoc(ref, { notes: notes })
        return true
      }
    }catch(e){
      console.error('loadNotesRemote error', e)
      return false
    }
  }

  async function saveNotesRemote(uid){
    // ORIGINAL: save entire notes array into users doc
    // Kept for reference only — this function is no longer invoked.
    if(!db) return false
    try{
      const ref = doc(db, 'users', uid)
      await setDoc(ref, { notes: notes }, { merge: true })
      return true
    }catch(e){
      console.error('saveNotesRemote error', e)
      return false
    }
  }
  // -------------------------------------------------------------------------------------

  // Merge two arrays of notes by id; use item with larger updated timestamp when conflict;
  // include notes that exist in only one side.
  function mergeNotes(localArr, remoteArr){
    const map = new Map()
    for(const it of localArr || []){
      map.set(it.id, {...it})
    }
    for(const r of remoteArr || []){
      const exist = map.get(r.id)
      if(!exist){
        map.set(r.id, {...r})
      }else{
        // both exist => choose newest by updated (or created)
        const tLocal = exist.updated || exist.created || 0
        const tRemote = r.updated || r.created || 0
        if(tRemote > tLocal){
          map.set(r.id, {...r})
        }else{
          // keep local (already in map)
        }
      }
    }
    // Return array preserving "created" order (sort by created asc)
    return Array.from(map.values()).sort((a,b)=> (a.created||0) - (b.created||0))
  }

  // ---------------- UI / render ----------------
  function renderNotes(filter=''){
    notesList.innerHTML = ''
    const f = filter.trim().toLowerCase()
    const shown = notes.slice().reverse().filter(n => {
      if(!f) return true
      return (n.title||'').toLowerCase().includes(f) || (n.content||'').toLowerCase().includes(f)
    })

    if(shown.length===0){
      notesList.innerHTML = '<div class="empty">Không có ghi chú nào.</div>'
      return
    }

    for(const n of shown){
      const el = document.createElement('div')
      el.className = 'note-card'
      el.innerHTML = `<strong>${escapeHtml(n.title||'Untitled')}</strong><small>${new Date(n.updated||n.created).toLocaleString()}</small><div style="margin-top:6px;color:var(--muted);font-size:13px">${escapeHtml((n.content||'').slice(0,120))}</div>`
      el.onclick = ()=> openNote(n.id)
      notesList.appendChild(el)
    }
  }

  function openNote(id){
    activeId = id
    const n = notes.find(x=>x.id===id)
    if(!n) return
    titleEl.value = n.title||''
    contentEl.value = n.content||''
    metaEl.textContent = `Tạo: ${new Date(n.created).toLocaleString()} • Cập nhật: ${new Date(n.updated||n.created).toLocaleString()}`
    editor.style.display = ''
    emptyState.style.display = 'none'
  }

  function createNote(){
    const now = Date.now()
    const n = { id: uid(), title: '', content: '', created: now, updated: now }
    notes.push(n)
    saveNotesLocal()
    // NOTE: we do NOT automatically call saveNoteToFirestore here (per instructions).
    renderNotes(qInput.value)
    openNote(n.id)
  }

  async function saveActiveNote(){
    if(!activeId) return
    const n = notes.find(x=>x.id===activeId)
    if(!n) return
    n.title = titleEl.value
    n.content = contentEl.value
    n.updated = Date.now()
    saveNotesLocal()
    if(currentUser){
      // NEW: save single note to Firestore (as requested)
      await saveNoteToFirestore(n)
    }
    renderNotes(qInput.value)
    metaEl.textContent = `Tạo: ${new Date(n.created).toLocaleString()} • Cập nhật: ${new Date(n.updated).toLocaleString()}`
    btnSave.textContent = 'Đã lưu'
    setTimeout(()=> btnSave.textContent = 'Lưu', 700)
  }

  function deleteActiveNote(){
    if(!activeId) return
    if(!confirm('Xác nhận xóa ghi chú này?')) return
    notes = notes.filter(x=>x.id!==activeId)
    saveNotesLocal()
    // Note: we are NOT deleting from Firestore here. Could be added if needed.
    activeId = null
    editor.style.display = 'none'
    emptyState.style.display = ''
    renderNotes(qInput.value)
  }

  function clearAll(){
    if(!confirm('Xóa tất cả ghi chú? Hành động không thể hoàn tác.')) return
    notes = []
    saveNotesLocal()
    // Note: we are NOT deleting all Firestore notes here.
    activeId = null
    editor.style.display = 'none'
    emptyState.style.display = ''
    renderNotes()
  }

  function importJson(file){
    const r = new FileReader()
    r.onload = async ()=>{
      try{
        const parsed = JSON.parse(r.result)
        if(Array.isArray(parsed)){
          const existingIds = new Set(notes.map(n=>n.id))
          for(const it of parsed){
            if(!it.id) it.id = uid()
            if(existingIds.has(it.id)) it.id = uid()
            notes.push({
              id: it.id,
              title: it.title || '',
              content: it.content || '',
              created: it.created || Date.now(),
              updated: it.updated || it.created || Date.now()
            })
          }
          saveNotesLocal();
          // If you want to push imported notes to Firestore, consider looping saveNoteToFirestore here.
          renderNotes(); alert('Nhập thành công')
        }else{
          alert('Tập tin không chứa mảng ghi chú')
        }
      }catch(e){alert('Không thể đọc file: ' + e.message)}
    }
    r.readAsText(file)
  }

  function escapeHtml(s){
    return (s+'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c])
  }

  // ---------------- Auth & Sync handlers ----------------
  btnSignIn.onclick = async ()=>{
    if(!auth){
      alert('Firebase chưa được cấu hình. Vui lòng dán firebaseConfig vào app.js')
      return
    }
    try{
      await signInWithPopup(auth, provider)
    }catch(e){
      alert('Đăng nhập thất bại: ' + e.message)
    }
  }

  btnSignOut.onclick = async ()=>{
    if(!auth) return
    await signOut(auth)
  }

  onAuthStateChanged(auth || { onAuthStateChanged: ()=>{} }, async (user)=>{
    currentUser = user
    if(user){
      btnSignIn.style.display = 'none'
      btnSignOut.style.display = ''
      syncStatus.textContent = 'Đang đồng bộ...'
      // Load local first, then load from Firestore for this user
      loadNotesLocal()
      const ok = await loadNotesFromFirestore(user.uid)
      if(ok) syncStatus.textContent = 'Đồng bộ (cloud)'
      else syncStatus.textContent = 'Lỗi đồng bộ, dùng local'
    }else{
      btnSignIn.style.display = ''
      btnSignOut.style.display = 'none'
      syncStatus.textContent = 'Offline'
      loadNotesLocal()
    }
    renderNotes(qInput.value)
  })

  // ---------------- Event wiring ----------------
  btnNew.onclick = createNote
  btnSave.onclick = ()=>{ if(!activeId) createNote(); saveActiveNote() }
  btnDelete.onclick = deleteActiveNote
  btnClearAll.onclick = clearAll
  fileImport.onchange = e=>{ const f = e.target.files && e.target.files[0]; if(f) importJson(f); fileImport.value = '' }

  qInput.oninput = ()=> renderNotes(qInput.value)
  window.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n'){ e.preventDefault(); createNote() }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveActiveNote() }
  })

  // ---------------- init ----------------
  (()=>{
    loadNotesLocal()
    if(notes.length===0){
      notes.push({id:uid(),title:'Chào mừng!',content:'Đây là ghi chú mẫu. Tạo ghi chú mới bằng nút + Ghi chú mới. Dữ liệu lưu cục bộ trong trình duyệt.',created:Date.now(),updated:Date.now()})
      saveNotesLocal()
    }
    renderNotes()
  })()

})();
