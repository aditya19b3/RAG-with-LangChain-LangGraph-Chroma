// Frontend Logic - IntellectRAG

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const scopeTenant = document.getElementById('scope-tenant');
  const scopeRole = document.getElementById('scope-role');
  
  const inputOpenAIKey = document.getElementById('settings-openai-key');
  const inputChromaURL = document.getElementById('settings-chroma-url');
  const btnSaveCredentials = document.getElementById('btn-save-credentials');
  const btnClearCredentials = document.getElementById('btn-clear-credentials');
  const credentialsStatus = document.getElementById('credentials-status');
  const credentialsStatusText = document.getElementById('credentials-status-text');
  
  const btnReindex = document.getElementById('btn-reindex');
  const docCount = document.getElementById('doc-count');
  const documentList = document.getElementById('document-list');
  
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  
  const qaForm = document.getElementById('qa-form');
  const queryInput = document.getElementById('query-input');
  const btnSubmit = document.getElementById('btn-submit');
  
  const resultContainer = document.getElementById('result-container');
  const resultSkeleton = document.getElementById('result-skeleton');
  const answerCard = document.getElementById('answer-card');
  const answerText = document.getElementById('answer-text');
  const sourcesList = document.getElementById('sources-list');
  const chromaStatus = document.getElementById('chroma-status');
  
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  
  const suggestionChips = document.querySelectorAll('.chip');

  const userProfile = document.getElementById('user-profile');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const btnLogout = document.getElementById('btn-logout');

  // Base API URL (relative since we serve frontend from Express/Vercel)
  const API_BASE = '';

  // ========================
  //  Authentication Guard
  // ========================

  // Synchronous check: redirect immediately if no stored session.
  // This prevents the flash of the main app before redirect.
  if (!isLoggedIn()) {
    window.location.href = '/login.html';
    return; // Stop all further initialization
  }

  // Show stored user info immediately (from localStorage) to avoid flicker
  const storedUser = getStoredUser();
  if (storedUser) {
    userProfile.classList.remove('hidden');
    userName.textContent = storedUser.displayName || storedUser.email || 'User';
    if (storedUser.photoURL) {
      userAvatar.src = storedUser.photoURL;
      userAvatar.style.display = 'block';
    } else {
      userAvatar.style.display = 'none';
    }
  }

  let currentUser = null;
  let firebaseResolved = false;
  let pendingRedirectTimer = null;

  // Firebase auth listener: confirms the session and loads app data.
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      if (!firebaseResolved && isLoggedIn()) {
        // First callback with null, but we have a localStorage session.
        // Firebase hasn't finished restoring from IndexedDB yet — wait before redirecting.
        // If a real user arrives (next callback), we cancel this timer.
        if (!pendingRedirectTimer) {
          pendingRedirectTimer = setTimeout(() => {
            // Grace period expired and still no user — session is genuinely invalid
            clearAuthSession();
            window.location.href = '/login.html';
          }, 3000);
        }
        return;
      }
      // Firebase has resolved before OR no localStorage session — redirect immediately
      clearAuthSession();
      window.location.href = '/login.html';
      return;
    }

    // User confirmed — cancel any pending redirect
    firebaseResolved = true;
    if (pendingRedirectTimer) {
      clearTimeout(pendingRedirectTimer);
      pendingRedirectTimer = null;
    }

    currentUser = user;

    // Update stored session with fresh data
    saveAuthSession(user);

    // Update user profile in header with live Firebase data
    userProfile.classList.remove('hidden');
    userName.textContent = user.displayName || user.email || 'User';
    if (user.photoURL) {
      userAvatar.src = user.photoURL;
      userAvatar.style.display = 'block';
    } else {
      userAvatar.style.display = 'none';
    }

    // Load cloud credentials and app data
    await loadCloudCredentials();
    fetchChromaStatus();
    fetchDocuments();
  });

  // Logout
  btnLogout.addEventListener('click', async () => {
    try {
      await signOut();
      // onAuthStateChanged will handle redirect
    } catch (err) {
      showToast('Failed to sign out: ' + err.message, 'error');
    }
  });

  // ========================
  //  Auth + Credential Headers
  // ========================

  /**
   * Returns combined auth + credential headers for all API requests.
   */
  async function getAllHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };

    // Auth token
    const authHeaders = await getAuthHeaders();
    Object.assign(headers, authHeaders);

    return headers;
  }

  // ========================
  //  Cloud Credential Management
  // ========================

  async function loadCloudCredentials() {
    try {
      const headers = await getAllHeaders();
      const res = await fetch(`${API_BASE}/api/credentials`, { headers });

      if (res.status === 401) {
        // Token expired — force re-auth
        await signOut();
        return;
      }

      const data = await res.json();
      if (data.success && data.credentials) {
        const c = data.credentials;
        // Show masked values as placeholders, don't expose real keys
        if (c.openAIApiKeySet) {
          inputOpenAIKey.placeholder = c.openAIApiKey; // e.g. "••••abcd"
          inputOpenAIKey.value = '';
        }
        if (c.chromaUrl) {
          inputChromaURL.value = c.chromaUrl;
        }

        credentialsStatus.classList.remove('hidden');
        credentialsStatusText.textContent = 'Credentials saved in cloud';
      }
    } catch (err) {
      console.warn('Could not load cloud credentials:', err);
    }
  }

  async function saveCloudCredentials() {
    try {
      const headers = await getAllHeaders({ 'Content-Type': 'application/json' });
      const body = {};

      // Only send non-empty values
      if (inputOpenAIKey.value.trim()) body.openAIApiKey = inputOpenAIKey.value.trim();
      if (inputChromaURL.value.trim()) body.chromaUrl = inputChromaURL.value.trim();

      if (Object.keys(body).length === 0) {
        showToast('Enter at least one credential to save.', 'error');
        return;
      }

      const res = await fetch(`${API_BASE}/api/credentials`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (res.status === 401) {
        await signOut();
        return;
      }

      const data = await res.json();
      if (data.success) {
        showToast('Credentials saved securely in the cloud!', 'success');
        credentialsStatus.classList.remove('hidden');
        credentialsStatusText.textContent = 'Credentials saved in cloud';
        // Clear the raw key from the input for security
        if (inputOpenAIKey.value.trim()) {
          inputOpenAIKey.placeholder = '••••' + inputOpenAIKey.value.trim().slice(-4);
          inputOpenAIKey.value = '';
        }
        fetchChromaStatus();
        fetchDocuments();
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast('Failed to save credentials: ' + err.message, 'error');
    }
  }

  async function clearCloudCredentials() {
    try {
      const headers = await getAllHeaders();
      const res = await fetch(`${API_BASE}/api/credentials`, {
        method: 'DELETE',
        headers,
      });

      if (res.status === 401) {
        await signOut();
        return;
      }

      const data = await res.json();
      if (data.success) {
        inputOpenAIKey.value = '';
        inputOpenAIKey.placeholder = 'sk-proj-...';
        inputChromaURL.value = '';
        credentialsStatus.classList.add('hidden');
        showToast('Credentials deleted from cloud.', 'info');
        fetchChromaStatus();
        fetchDocuments();
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast('Failed to clear credentials: ' + err.message, 'error');
    }
  }

  // ========================
  //  Utilities
  // ========================

  // Toast Notifications
  let toastTimeout;
  function showToast(message, type = 'info') {
    clearTimeout(toastTimeout);
    toastMessage.textContent = message;
    
    // Reset classes
    toast.className = 'toast';
    toast.classList.add(type);
    
    // Show toast
    toast.classList.remove('hidden');
    
    // Hide toast after 4s
    toastTimeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 4000);
  }

  // Format File Size
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Helper to escape HTML to prevent XSS
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Format Answer Paragraphs & Citations
  function formatAnswer(text) {
    // Escape HTML first
    let html = escapeHtml(text);
    
    // Replace citations like [1], [2] with highlighted spans
    html = html.replace(/\[(\d+)\]/g, '<span class="citation-badge">[$1]</span>');
    
    // Split double newlines into paragraphs
    return html
      .split('\n\n')
      .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  // ========================
  //  API Communication
  // ========================

  // Check ChromaDB connection status
  async function fetchChromaStatus() {
    try {
      const headers = await getAllHeaders();
      const res = await fetch(`${API_BASE}/api/chroma/status`, { headers });

      if (res.status === 401) {
        await signOut();
        return;
      }

      const data = await res.json();

      if (!data.success) throw new Error(data.error);

      const statusEl = chromaStatus;
      const textEl = statusEl.querySelector('.status-text');

      if (data.healthy) {
        statusEl.className = 'status-badge status-connected';
        textEl.textContent = `ChromaDB • ${data.collection.count} chunks`;
      } else {
        statusEl.className = 'status-badge status-syncing';
        textEl.textContent = 'ChromaDB Offline';
        showToast('ChromaDB is not running. Start it with: docker compose up -d', 'error');
      }
    } catch (error) {
      console.error('Chroma status check failed:', error);
      chromaStatus.className = 'status-badge status-syncing';
      chromaStatus.querySelector('.status-text').textContent = 'ChromaDB Offline';
    }
  }

  async function fetchDocuments() {
    try {
      const headers = await getAllHeaders();
      const res = await fetch(`${API_BASE}/api/documents`, { headers });

      if (res.status === 401) {
        await signOut();
        return;
      }

      const data = await res.json();
      
      if (!data.success) throw new Error(data.error);

      documentList.innerHTML = '';
      docCount.textContent = data.documents.length;

      if (data.documents.length === 0) {
        documentList.innerHTML = `
          <li class="empty-state-list">
            <i class="fa-regular fa-folder-closed"></i>
            <span>No documents uploaded yet.</span>
          </li>
        `;
        return;
      }

      data.documents.forEach((doc) => {
        const fileIconClass = doc.name.endsWith('.pdf') ? 'fa-file-pdf' : 'fa-file-lines';
        const formattedSize = formatBytes(doc.size);
        const dateStr = new Date(doc.lastModified).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const li = document.createElement('li');
        li.className = 'doc-item';
        li.innerHTML = `
          <div class="doc-info">
            <i class="fa-solid ${fileIconClass} doc-info-icon"></i>
            <div class="doc-meta">
              <span class="doc-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
              <span class="doc-details">${formattedSize} • Modified ${dateStr}</span>
            </div>
          </div>
          <button class="btn btn-danger-sm btn-delete" data-filename="${encodeURIComponent(doc.name)}" title="Delete document">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        `;
        documentList.appendChild(li);
      });

      // Attach Delete Listeners
      documentList.querySelectorAll('.btn-delete').forEach(button => {
        button.addEventListener('click', async (e) => {
          e.stopPropagation();
          const filename = button.getAttribute('data-filename');
          if (confirm(`Are you sure you want to delete this document from the knowledge base?`)) {
            await deleteDocument(filename);
          }
        });
      });

    } catch (error) {
      console.error('Failed to load documents:', error);
      showToast(`Error fetching documents: ${error.message}`, 'error');
    }
  }

  // Delete Document
  async function deleteDocument(encodedFilename) {
    try {
      const headers = await getAllHeaders();
      const res = await fetch(`${API_BASE}/api/documents/${encodedFilename}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      
      if (!data.success) throw new Error(data.error);
      
      showToast(data.message, 'success');
      await fetchDocuments();
      await fetchChromaStatus();
    } catch (error) {
      console.error('Deletion failed:', error);
      showToast(`Failed to delete file: ${error.message}`, 'error');
    }
  }

  // Upload Document
  async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    showToast(`Uploading & indexing ${file.name}...`, 'info');
    chromaStatus.className = 'status-badge status-syncing';
    chromaStatus.querySelector('.status-text').textContent = 'Indexing...';

    try {
      const headers = await getAllHeaders();
      // Don't set Content-Type for FormData — browser auto-sets with boundary
      const res = await fetch(`${API_BASE}/api/documents`, {
        method: 'POST',
        body: formData,
        headers,
      });
      const data = await res.json();

      if (!data.success) throw new Error(data.error);

      showToast(data.message, 'success');
      await fetchDocuments();
      await fetchChromaStatus();
    } catch (error) {
      console.error('Upload failed:', error);
      showToast(`Upload failed: ${error.message}`, 'error');
      await fetchChromaStatus();
    }
  }

  // Trigger Database Re-indexing
  async function triggerReindex() {
    // Visual indicators
    btnReindex.disabled = true;
    btnReindex.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
    chromaStatus.className = 'status-badge status-syncing';
    chromaStatus.querySelector('.status-text').textContent = 'Indexing...';
    
    showToast('Re-indexing database with new document chunks...', 'info');

    try {
      const headers = await getAllHeaders();
      const res = await fetch(`${API_BASE}/api/index`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();

      if (!data.success) throw new Error(data.error);

      showToast(data.message, 'success');
      await fetchChromaStatus();
    } catch (error) {
      console.error('Indexing failed:', error);
      showToast(`Indexing failed: ${error.message}`, 'error');
    } finally {
      // Restore states
      btnReindex.disabled = false;
      btnReindex.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync DB';
      await fetchChromaStatus();
    }
  }

  // Submit Q&A Query
  async function submitQuery(question) {
    if (!question.trim()) return;

    // Reset Result Panel
    resultContainer.classList.remove('hidden');
    resultSkeleton.classList.remove('hidden');
    answerCard.classList.add('hidden');
    
    // Disable inputs
    btnSubmit.disabled = true;
    queryInput.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running';

    const payload = {
      question: question.trim(),
      tenantId: scopeTenant.value,
      role: scopeRole.value,
    };

    try {
      const startTime = performance.now();
      const headers = await getAllHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`${API_BASE}/api/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const duration = ((performance.now() - startTime) / 1000).toFixed(1);

      if (!data.success) throw new Error(data.error);

      // Render answer
      answerText.innerHTML = formatAnswer(data.answer);
      document.getElementById('timing-badge').textContent = `Corrective RAG • ${duration}s`;

      // Render sources
      sourcesList.innerHTML = '';
      if (data.sources && data.sources.length > 0) {
        data.sources.forEach(source => {
          const tag = document.createElement('span');
          tag.className = 'source-tag';
          tag.innerHTML = `<i class="fa-solid fa-file-lines"></i> ${escapeHtml(source)}`;
          sourcesList.appendChild(tag);
        });
      } else {
        sourcesList.innerHTML = '<span class="source-tag-none">No sources cited (External knowledge fallback or insufficient context)</span>';
      }

      // Toggle views
      resultSkeleton.classList.add('hidden');
      answerCard.classList.remove('hidden');

    } catch (error) {
      console.error('Query failed:', error);
      showToast(`Error processing query: ${error.message}`, 'error');
      resultContainer.classList.add('hidden');
    } finally {
      // Re-enable inputs
      btnSubmit.disabled = false;
      queryInput.disabled = false;
      btnSubmit.innerHTML = '<span>Ask AI</span> <i class="fa-solid fa-paper-plane"></i>';
    }
  }

  // --- Event Listeners ---

  // Manual Re-index
  btnReindex.addEventListener('click', triggerReindex);

  // Form submit
  qaForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitQuery(queryInput.value);
  });

  // Suggestion Chips
  suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const question = chip.getAttribute('data-question');
      queryInput.value = question;
      submitQuery(question);
    });
  });

  // File Upload Handlers (Click Area)
  uploadZone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });

  // Drag & Drop
  ['dragenter', 'dragover'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
    }, false);
  });

  uploadZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      uploadFile(files[0]);
    }
  });

  // Credentials event listeners — now cloud-backed
  btnSaveCredentials.addEventListener('click', saveCloudCredentials);
  btnClearCredentials.addEventListener('click', clearCloudCredentials);
});
