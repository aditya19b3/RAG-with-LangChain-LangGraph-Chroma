// Frontend Logic - IntellectRAG

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const scopeTenant = document.getElementById('scope-tenant');
  const scopeRole = document.getElementById('scope-role');
  
  const inputOpenAIKey = document.getElementById('settings-openai-key');
  const inputChromaURL = document.getElementById('settings-chroma-url');
  const btnSaveCredentials = document.getElementById('btn-save-credentials');
  const btnClearCredentials = document.getElementById('btn-clear-credentials');
  
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

  // Base API URL (relative since we serve frontend from Express)
  const API_BASE = '';

  // Load and Get Dynamic Credentials from LocalStorage
  function loadCredentials() {
    inputOpenAIKey.value = localStorage.getItem('openai_api_key') || '';
    inputChromaURL.value = localStorage.getItem('chroma_url') || '';
  }

  function getCredentialHeaders() {
    const headers = {};
    const openAIKey = localStorage.getItem('openai_api_key');
    const chromaURL = localStorage.getItem('chroma_url');
    
    if (openAIKey) headers['X-OpenAI-API-Key'] = openAIKey;
    if (chromaURL) headers['X-Chroma-URL'] = chromaURL;
    
    return headers;
  }

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

  // Check ChromaDB connection status
  async function fetchChromaStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/chroma/status`, {
        headers: getCredentialHeaders()
      });
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
      const res = await fetch(`${API_BASE}/api/documents`, {
        headers: getCredentialHeaders()
      });
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
      const res = await fetch(`${API_BASE}/api/documents/${encodedFilename}`, {
        method: 'DELETE',
        headers: getCredentialHeaders()
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
      const res = await fetch(`${API_BASE}/api/documents`, {
        method: 'POST',
        body: formData,
        headers: getCredentialHeaders()
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
      const res = await fetch(`${API_BASE}/api/index`, {
        method: 'POST',
        headers: getCredentialHeaders()
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
      const res = await fetch(`${API_BASE}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getCredentialHeaders()
        },
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

  // Credentials event listeners
  btnSaveCredentials.addEventListener('click', () => {
    localStorage.setItem('openai_api_key', inputOpenAIKey.value.trim());
    localStorage.setItem('chroma_url', inputChromaURL.value.trim());
    showToast('Credentials saved successfully!', 'success');
    fetchChromaStatus();
    fetchDocuments();
  });

  btnClearCredentials.addEventListener('click', () => {
    localStorage.removeItem('openai_api_key');
    localStorage.removeItem('chroma_url');
    inputOpenAIKey.value = '';
    inputChromaURL.value = '';
    showToast('Credentials cleared!', 'info');
    fetchChromaStatus();
    fetchDocuments();
  });

  // Initial Load
  loadCredentials();
  fetchChromaStatus();
  fetchDocuments();
});
