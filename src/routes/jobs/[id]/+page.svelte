<!-- src/routes/jobs/[id]/+page.svelte -->
<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { api, API_BASE } from '$lib/api/client.js';
  import { isStaff, isAdmin } from '$lib/stores/auth.js';
  import { auth } from '$lib/stores/auth.js';
  import LabelPrintModal from '$lib/components/LabelPrintModal.svelte';
  import FolderPickerModal from '$lib/components/FolderPickerModal.svelte';
  import ProofAnnotationCanvas from '$lib/components/ProofAnnotationCanvas.svelte';
  import {
    listJobFiles,
    ensureJobFolder,
    uploadJobFile,
    filesBridgeHealth,
    downloadFile as downloadBridgeFile
  } from '$lib/files/filesBridgeClient.js';

  let project = null;
  let notes = [];
  let messages = [];
  let newMessage = '';
  let sendingMessage = false;
  let messageErr = '';
  let items = [];
  let photos = [];
  let statuses = [];
  let employees = [];
  let projectTypes = [];
  let qbItems = [];
  let loading = true;
  let error = '';
  let activeTab = 'overview';
  let newNote = '';
  let addingNote = false;
  let changingStatus = false;
  let newStatusId = '';
  let statusNote = '';

  // Edit mode
  let editing = false;
  let saving = false;
  let editForm = {};

  // Add item
  let addingItem = false;
  let newItem = { qb_item_name: '', description: '', qty: 1, price: '', total: '' };
  let savingItem = false;
  let qbItemSearch = '';
  let showQBDropdown = false;

  // Edit/delete item
  let editingItem = null;
  let editItemForm = {};
  let showEditQBDropdown = false;
  let editQBItemSearch = '';

  // Add measurement
  let addingMeasurement = false;
  let newMeasurement = { item: '', width: '', height: '', notes: '' };
  let savingMeasurement = false;

  // Edit / delete measurement
  let editingMeasurement = null;      // the measurement currently being edited
  let editMeasurementForm = {};
  let savingMeasurementEdit = false;

  // Some rows were saved with NaN in width/height before the sanitization
  // fix. Display them as "—" so the table doesn't read like garbage.
  function fmtDim(v) {
    if (v === null || v === undefined || v === '' || v === 'NaN') return '—';
    const n = Number(v);
    return Number.isFinite(n) ? n : '—';
  }

  // Photos
  let uploadingPhotos = false;
  let photoInput;
  let lightboxPhoto = null;

  // Folder path
  let editingFolder = false;
  let folderPathInput = '';
  let savingFolder = false;

// Label printing
  let showLabelModal = false;

  // Folder-match modal (manual override for the files-bridge)
  let showFolderModal = false;

  // ─── "Send upload link" modal ──────────────────────────────────────────────
  // Mints a public upload-link via POST /api/jobs/:id/upload-links and shows
  // the resulting URL so staff can copy it (in addition to the email Resend
  // sends to the recipient).
  let showUploadLinkModal  = false;
  let uploadLinkRecipient  = '';
  let uploadLinkExpiryDays = 14;
  let uploadLinkMaxUploads = 20;
  let uploadLinkNote       = '';      // optional personal note included in the email
  let uploadLinkSubmitting = false;
  let uploadLinkError      = '';
  let uploadLinkResult     = null;   // { url, token, expires_at, max_uploads, recipient_email } on success

  function openUploadLinkModal() {
    // Pre-fill from whatever email we have on the project. The API
    // returns clients.email as `client_email` on /api/projects/:id; if
    // that's blank, leave the field empty for staff to type.
    uploadLinkRecipient  = project?.client_email || '';
    uploadLinkExpiryDays = 14;
    uploadLinkMaxUploads = 20;
    uploadLinkNote       = '';
    uploadLinkError      = '';
    uploadLinkResult     = null;
    showUploadLinkModal  = true;
  }

  async function submitUploadLink() {
    if (uploadLinkSubmitting) return;
    uploadLinkError = '';
    if (!uploadLinkRecipient || !/^\S+@\S+\.\S+$/.test(uploadLinkRecipient)) {
      uploadLinkError = 'Enter a valid email address.';
      return;
    }
    uploadLinkSubmitting = true;
    try {
      uploadLinkResult = await api.createUploadLink(project.id, {
        recipient_email: uploadLinkRecipient.trim(),
        expires_in_days: Number(uploadLinkExpiryDays) || 14,
        max_uploads:     Number(uploadLinkMaxUploads) || 20,
        note:            uploadLinkNote.trim() || undefined,
      });
    } catch (e) {
      uploadLinkError = e.message || 'Failed to create the upload link.';
    } finally {
      uploadLinkSubmitting = false;
    }
  }

  function copyUploadLink() {
    if (!uploadLinkResult?.url) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(uploadLinkResult.url).catch(() => {});
    }
  }

  function closeUploadLinkModal() {
    showUploadLinkModal = false;
    // Refresh the files panel — they may upload while the modal is closed
    // and we want to be ready to show new files when the customer drops them.
    refreshFiles().catch(() => {});
  }

  // L: drive files (via files-bridge)
  let filesData = { resolved: false, entries: [] };
  let filesLoading = false;
  let filesError = '';
  let creatingFolder = false;

  // Description that goes on the end of a new job folder — "Job3921 - Truck
  // Letters". Defaults to the job description; staff can shorten it before
  // creating so the name stays readable in Explorer.
  let folderDesc = '';
  let folderDescForJob = null;
  $: if (project && folderDescForJob !== project.id) {
    folderDescForJob = project.id;
    folderDesc = project.project_name || '';
  }

  // Mirrors sanitizeFolderDesc in files-bridge/server.js so the preview
  // shows the name that will actually land on disk.
  function cleanFolderDesc(input) {
    return String(input || '')
      .replace(/[^A-Za-z0-9 _.\-&',()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)
      .replace(/^[.\s]+|[.\s]+$/g, '');
  }
  $: newFolderName = project
    ? (cleanFolderDesc(folderDesc) ? `Job${project.id} - ${cleanFolderDesc(folderDesc)}` : `Job${project.id}`)
    : '';

  // The bridge only honours the description from 1.3.0 on. An older copy
  // still running on the RIP box silently creates bare "Job3921" folders,
  // which is exactly the complaint this is meant to fix — so say so.
  let bridgeStale = false;
  async function checkBridgeFeatures() {
    try {
      const health = await filesBridgeHealth();
      bridgeStale = !(health?.features || []).includes('job-folder-desc');
    } catch {
      bridgeStale = false;   // unreachable is reported elsewhere; don't cry wolf
    }
  }

  // The effective folder name — uses the manual override
  // (clients.files_folder, exposed as client_folder_name on the project row
  // from the API) when set, falls back to the auto-derived client_name
  // otherwise. Also handles older API responses that predate the override
  // column.
  $: clientFolderName = project?.client_folder_name || project?.client_name || '';

  async function refreshFiles() {
    if (!$isStaff) return;
    if (!clientFolderName || !project?.id) return;
    checkBridgeFeatures();
    filesLoading = true; filesError = '';
    try {
      filesData = await listJobFiles(clientFolderName, project.id);
    } catch (e) {
      filesError = e.message || String(e);
    } finally {
      filesLoading = false;
    }
  }

  async function createJobFolder() {
    if (!clientFolderName || !project?.id) return;
    creatingFolder = true; filesError = '';
    try {
      await ensureJobFolder(clientFolderName, project.id, cleanFolderDesc(folderDesc));
      await refreshFiles();
    } catch (e) {
      filesError = e.message || String(e);
    } finally {
      creatingFolder = false;
    }
  }

  // Called by FolderPickerModal after save. Reload the project so
  // client_folder_name / client_folder_override reflect the new choice,
  // then refresh the file listing.
  async function onFolderMatchSaved() {
    try {
      project = await api.getProject(id);
      await refreshFiles();
    } catch (e) {
      filesError = e.message || String(e);
    }
  }

  // Tab change handler. No lazy-loading needed now that the LED/WiFi/Modules
  // tabs have moved to the client detail page.
  function onTabChange(t) {
    activeTab = t;
    if (t === 'quoting' && !quoteLoaded) loadQuoteSheet();
    if (t === 'proofs' && !proofsLoaded) loadProofs();
    if (t === 'schedule' && !jobTasksLoaded) loadSchedule();
  }

  async function downloadBridgeEntry(entry) {
    try { await downloadBridgeFile(entry.path, entry.name); }
    catch (e) { alert('Could not download file: ' + (e.message || e)); }
  }

  // Build a holm:// URL that the staff machine's protocol handler will turn
  // into "open this file/folder in its native Windows program / Explorer".
  // The handler validates the path against an allowlist (\\LS220D146\share\,
  // L:\) — see tools/staff-machine/holm-handler.ps1. Staff machines need
  // install-holm-protocol.ps1 run once before these links work; otherwise
  // clicking does nothing (browser shows "Open with…" prompt with no choices).
  function holmUrl(path) {
    if (!path) return '#';
    return 'holm://open?path=' + encodeURIComponent(path);
  }

  // Some bridge tree responses include `entry.path` for files but not always
  // for directories. Fall back to joining the job path + entry name with a
  // backslash — Windows paths use backslash, and the handler canonicalises
  // before allowlist matching so a stray separator is fine.
  function entryPath(entry) {
    if (entry?.path) return entry.path;
    if (filesData?.jobPath && entry?.name) {
      return filesData.jobPath.replace(/\\?$/, '\\') + entry.name;
    }
    return '';
  }

  function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return '📄';
    if (['png','jpg','jpeg','gif','webp','tiff','tif','bmp','svg'].includes(ext)) return '🖼️';
    if (['ai','eps','cdr','psd','indd','sketch'].includes(ext)) return '🎨';
    if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
    if (['doc','docx','txt','rtf'].includes(ext)) return '📝';
    if (['xls','xlsx','csv'].includes(ext)) return '📊';
    if (['mp4','mov','avi','mkv'].includes(ext)) return '🎬';
    return '📎';
  }

  function fileIsInline(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ext === 'pdf' ||
      ['png','jpg','jpeg','gif','webp','svg'].includes(ext) ||
      ['txt','html','xml','json','csv'].includes(ext);
  }

  function formatBytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function formatFileDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return iso || ''; }
  }

  // Quote sheet — internal worksheet with cost/markup/sale per row.
  // Promotable into the customer-facing Items table.
  let quoteRows = [];
  let quoteLoaded = false;
  let quoteLoading = false;
  let quoteError = '';
  let promotingQuote = false;

  async function loadQuoteSheet() {
    if (quoteLoading) return;
    quoteLoading = true;
    quoteError = '';
    try {
      const data = await api.getQuoteSheet(id);
      quoteRows = data?.rows || [];
      quoteLoaded = true;
    } catch (e) {
      quoteError = e.message;
    } finally {
      quoteLoading = false;
    }
  }

  async function addQuoteRow() {
    try {
      const row = await api.addQuoteRow(id, {
        item: '', qty: 1, cost_per_unit: 0, markup: 2, sale_per_unit: 0
      });
      quoteRows = [...quoteRows, row];
    } catch (e) { quoteError = e.message; }
  }

  async function removeQuoteRow(row) {
    if (!confirm(`Delete "${row.item || 'this row'}"?`)) return;
    try {
      await api.deleteQuoteRow(id, row.id);
      quoteRows = quoteRows.filter(r => r.id !== row.id);
    } catch (e) { quoteError = e.message; }
  }

  // Editing cost or markup auto-recomputes sale; the user can still
  // override sale_per_unit directly afterwards.
  function recomputeSale(row) {
    const c = parseFloat(row.cost_per_unit) || 0;
    const m = parseFloat(row.markup) || 0;
    row.sale_per_unit = +(c * m).toFixed(2);
    quoteRows = quoteRows;
  }
  function bumpTotals() { quoteRows = quoteRows; }

  // Save-on-blur: each input fires on:change which calls this with the
  // field name; the API gets the current value of that field (and
  // sale_per_unit too if cost/markup were the trigger, so the cached
  // computed value isn't lost on the server).
  async function saveQuoteField(row, field, includeSale = false) {
    const patch = { [field]: row[field] };
    if (includeSale) patch.sale_per_unit = row.sale_per_unit;
    try {
      const updated = await api.updateQuoteRow(id, row.id, patch);
      // Reassign updated_at etc from server response but keep local edits.
      Object.assign(row, { updated_at: updated.updated_at });
      quoteRows = quoteRows;
    } catch (e) { quoteError = e.message; }
  }

  async function promoteQuote() {
    if (promotingQuote) return;
    if (quoteRows.length === 0) { alert('No rows to promote.'); return; }
    if (!confirm(`Add ${quoteRows.length} row${quoteRows.length === 1 ? '' : 's'} to the Items tab at sale price?`)) return;
    promotingQuote = true;
    try {
      const { inserted } = await api.promoteQuoteSheet(id);
      items = await api.getItems(id);
      alert(`Added ${inserted} item${inserted === 1 ? '' : 's'} to Items.`);
    } catch (e) {
      quoteError = e.message;
    } finally {
      promotingQuote = false;
    }
  }

  function rowTotal(r) {
    return (parseFloat(r.qty) || 0) * (parseFloat(r.sale_per_unit) || 0);
  }
  $: quoteGrandTotal = quoteRows.reduce((sum, r) => sum + rowTotal(r), 0);
  function fmtMoney(n) {
    const v = parseFloat(n) || 0;
    return `$${v.toFixed(2)}`;
  }

  // ─── Proofs (customer approval) ─────────────────────────────────────────
  // A proof is a JPEG/PNG of the artwork sent to the customer for sign-off.
  // The customer hits /proofs/<token> (no login), can mark up the image,
  // and clicks Approve or Request changes. The response posts back into the
  // project Messages tab and notifies assigned staff.
  let proofs = [];
  let proofsLoaded = false;
  let proofsLoading = false;
  let proofsError = '';

  // Upload form state
  let proofFile = null;
  let proofRecipientEmail = '';
  let proofApproveStatusId = '';        // optional: bump the job status when customer approves
  let proofNote = '';
  let uploadingProof = false;
  let proofUploadError = '';

  // Selected version for the in-page viewer (defaults to the latest).
  let selectedProofId = null;
  let proofPreviewEl;                  // bound to the preview card for scrollIntoView
  $: selectedProof = proofs.find(p => p.id === selectedProofId) || null;

  // Click handler for the View button. Sets selection AND scrolls the
  // preview card into view — without this the preview renders below
  // 10+ history rows and looks like nothing happened.
  async function viewProof(p) {
    selectedProofId = p.id;
    await tick();
    if (proofPreviewEl?.scrollIntoView) {
      proofPreviewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Statuses we offer for the "auto-bump on approval" dropdown.
  // Reasonable defaults: Production / Ready-for-pickup-style statuses
  // make sense; we filter at render time using status_name.
  $: bumpStatusOptions = statuses.filter(s =>
    /production|approved|ready|in.?progress|build|print|hold/i.test(s.status_name || '')
  );

  async function loadProofs(force = false) {
    if (proofsLoading) return;
    if (proofsLoaded && !force) return;
    proofsLoading = true;
    proofsError = '';
    try {
      // API shape: { proofs: [...] } — newest first.
      const resp = await api.listProjectProofs(id);
      proofs = Array.isArray(resp) ? resp : (resp.proofs || []);
      proofsLoaded = true;
      if (!selectedProofId && proofs.length) selectedProofId = proofs[0].id;
    } catch (e) {
      proofsError = e.message || 'Failed to load proofs.';
    } finally {
      proofsLoading = false;
    }
  }

  function onProofFileChange(ev) {
    const f = ev.target.files?.[0];
    if (!f) { proofFile = null; return; }
    if (!/^image\/(jpeg|jpg|png)$/i.test(f.type)) {
      proofUploadError = 'Pick a JPEG or PNG.';
      proofFile = null;
      ev.target.value = '';
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      proofUploadError = 'File is too large (25 MB max).';
      proofFile = null;
      ev.target.value = '';
      return;
    }
    proofUploadError = '';
    proofFile = f;
  }

  async function submitProof() {
    if (uploadingProof) return;
    proofUploadError = '';
    if (!proofFile) { proofUploadError = 'Pick an image first.'; return; }
    if (!proofRecipientEmail || !/^\S+@\S+\.\S+$/.test(proofRecipientEmail)) {
      proofUploadError = 'Enter a valid recipient email.';
      return;
    }
    uploadingProof = true;
    try {
      const result = await api.uploadProjectProof(id, {
        file: proofFile,
        recipientEmail: proofRecipientEmail.trim(),
        approveStatusId: proofApproveStatusId ? Number(proofApproveStatusId) : null,
        note: proofNote.trim() || null,
      });
      // Surface the email result so staff knows if the customer got it.
      // result.email = { ok: true, message_id } on success, { ok: false, error } on failure.
      if (result?.email && result.email.ok === false) {
        proofUploadError = `Proof saved but email to ${result.sent_to || 'customer'} failed: ${result.email.error || 'unknown error'}`;
      } else {
        // Reset form on success only — keep the form populated on failure
        // so staff can retry without re-picking the file.
        proofFile = null;
        proofNote = '';
        const fileInput = document.getElementById('proof-file-input');
        if (fileInput) fileInput.value = '';
      }
      await loadProofs(true);
      // POST response is the proof row directly, not wrapped.
      if (result?.id) selectedProofId = result.id;
    } catch (e) {
      proofUploadError = e.message || 'Upload failed.';
    } finally {
      uploadingProof = false;
    }
  }

  async function deleteProof(p) {
    if (!confirm(`Delete proof v${p.version}? This can't be undone.`)) return;
    try {
      await api.deleteProjectProof(id, p.id);
      await loadProofs(true);
    } catch (e) {
      proofsError = e.message || 'Delete failed.';
    }
  }

  function copyProofLink(p) {
    const url = `${window.location.origin}/proofs/${p.token}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => alert('Customer link copied to clipboard.'),
        () => prompt('Copy this link:', url)
      );
    } else {
      prompt('Copy this link:', url);
    }
  }

  function proofStatusLabel(s) {
    switch (s) {
      case 'sent': return 'Sent';
      case 'viewed': return 'Viewed';
      case 'approved': return 'Approved';
      case 'changes_requested': return 'Changes requested';
      case 'superseded': return 'Superseded';
      default: return s || '—';
    }
  }
  function proofStatusClass(s) {
    switch (s) {
      case 'approved': return 'pf-approved';
      case 'changes_requested': return 'pf-changes';
      case 'superseded': return 'pf-stale';
      case 'viewed': return 'pf-viewed';
      default: return 'pf-sent';
    }
  }

  // ─── Scheduling (Phase 2: job tasks on the Schedule tab) ────────────
  // Per-job task list. Pulled lazily when the Schedule tab is opened
  // so the initial job page render isn't slowed.
  let jobTasks = [];
  let jobTasksLoaded = false;
  let jobTasksLoading = false;
  let jobTasksError = '';
  // Resources + templates used by the Schedule tab's add-task form and
  // apply-template button. Shared with the install panel inside this tab.
  let schedulingResources = [];
  let taskTemplates = [];
  let applyTemplateId = '';
  let applyAnchor = 'due_date';
  let applyTargetDate = '';
  let installs = [];          // installs scheduled for THIS job
  let installsLoaded = false;
  // New-task draft (inline at the bottom of the list).
  let newTask = emptyTaskDraft();
  function emptyTaskDraft() {
    return {
      name: '', task_kind: 'labor',
      planned_start: '', planned_end: '',
      duration_hours: '', assigned_emp_id: '', resource_id: '',
      notes: '',
    };
  }

  // ─── Job phases (event-driven checklist) ────────────────────────────
  // Per-job linear checklist where checking one phase auto-activates
  // the next. Drives "ball in court" visibility — the calendar shows
  // who currently owns the schedule (shop / customer / vendor / authority).
  let phases = [];
  let phaseTemplates = [];
  let pickingPhaseTemplate = false;
  let phaseTemplateChoice = '';
  let completingPhase = null;   // { phase, nextExpectedDays }
  let editingPhase = null;      // phase row being edited inline

  async function loadPhases() {
    try {
      const [ph, tpls] = await Promise.all([
        api.listJobPhases(id),
        phaseTemplates.length ? Promise.resolve({ templates: phaseTemplates }) : api.listPhaseTemplates(),
      ]);
      phases         = ph.phases     || [];
      phaseTemplates = tpls.templates || [];
    } catch (e) { jobTasksError = e.message; }
  }

  async function applyPhaseTemplate() {
    if (!phaseTemplateChoice) return;
    try {
      const force = phases.length > 0;
      if (force && !confirm('This will replace the current phase checklist. Continue?')) return;
      await api.applyPhaseTemplate({
        project_id:  Number(id),
        template_id: Number(phaseTemplateChoice),
        force,
      });
      pickingPhaseTemplate = false;
      phaseTemplateChoice = '';
      await loadPhases();
    } catch (e) { jobTasksError = e.message; }
  }

  function openCompletePhase(p) {
    // Pre-fill with the next phase's existing expected_days so staff
    // can confirm or override on the spot.
    const next = phases.find((q) => q.phase_order > p.phase_order && q.status === 'pending');
    completingPhase = {
      phase: p,
      nextPhase: next,
      nextExpectedDays: next ? Number(next.expected_days || 2) : null,
    };
  }
  async function confirmCompletePhase() {
    if (!completingPhase) return;
    try {
      await api.completePhase(completingPhase.phase.id, completingPhase.nextExpectedDays);
      completingPhase = null;
      await loadPhases();
    } catch (e) { jobTasksError = e.message; }
  }
  async function skipPhase(p) {
    if (!confirm(`Skip "${p.name}"? This activates the next phase immediately.`)) return;
    try {
      await api.updatePhase(p.id, { status: 'skipped' });
      // Skipped status doesn't trigger the auto-advance — manually
      // activate the next one.
      const next = phases.find((q) => q.phase_order > p.phase_order && q.status === 'pending');
      if (next) {
        const days = Number(prompt(`Days for "${next.name}"?`, String(next.expected_days || 2))) || 2;
        await api.updatePhase(next.id, { status: 'active', expected_days: days });
      }
      await loadPhases();
    } catch (e) { jobTasksError = e.message; }
  }
  async function deletePhase(p) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    try {
      await api.deletePhase(p.id);
      await loadPhases();
    } catch (e) { jobTasksError = e.message; }
  }

  function openEditPhase(p) {
    editingPhase = {
      id: p.id,
      name: p.name,
      responsible_party: p.responsible_party,
      expected_days: p.expected_days != null ? Number(p.expected_days) : '',
      status: p.status,
      notes: p.notes || '',
    };
  }
  async function saveEditPhase() {
    if (!editingPhase?.id) return;
    try {
      await api.updatePhase(editingPhase.id, {
        name:              editingPhase.name,
        responsible_party: editingPhase.responsible_party,
        expected_days:     editingPhase.expected_days === '' ? null : Number(editingPhase.expected_days),
        status:            editingPhase.status,
        notes:             editingPhase.notes || null,
      });
      editingPhase = null;
      await loadPhases();
    } catch (e) { jobTasksError = e.message; }
  }

  function partyIcon(p) {
    switch (p) {
      case 'customer':  return '👤';
      case 'vendor':    return '📦';
      case 'authority': return '🏛';
      default:          return '🔨';
    }
  }
  function partyLabel(p) {
    switch (p) {
      case 'customer':  return 'Customer';
      case 'vendor':    return 'Vendor';
      case 'authority': return 'Authority';
      default:          return 'Shop';
    }
  }
  function partyColor(p) {
    switch (p) {
      case 'customer':  return '#ca8a04';
      case 'vendor':    return '#7c3aed';
      case 'authority': return '#0e7490';
      default:          return '#1e40af';
    }
  }

  async function loadSchedule() {
    if (jobTasksLoading) return;
    jobTasksLoading = true; jobTasksError = '';
    try {
      const [taskResp, resResp, tplResp, instResp] = await Promise.all([
        api.listJobTasks(id),
        schedulingResources.length ? Promise.resolve({ resources: schedulingResources }) : api.listResources(),
        taskTemplates.length        ? Promise.resolve({ templates: taskTemplates }) : api.listTemplates(),
        api.listInstallsByProject(id),
      ]);
      jobTasks            = taskResp.tasks      || [];
      schedulingResources = resResp.resources   || [];
      taskTemplates       = tplResp.templates   || [];
      installs            = instResp.installs   || [];
      jobTasksLoaded = true;
      installsLoaded = true;
      // Phases load in parallel but failure shouldn't block the rest.
      loadPhases().catch(() => {});
    } catch (e) {
      jobTasksError = e.message || 'Failed to load schedule.';
    } finally {
      jobTasksLoading = false;
    }
  }

  async function addTask() {
    if (!newTask.name.trim()) { jobTasksError = 'Task name required.'; return; }
    try {
      await api.createJobTask({
        project_id:      Number(id),
        name:            newTask.name.trim(),
        task_kind:       newTask.task_kind,
        planned_start:   newTask.planned_start || null,
        planned_end:     newTask.planned_end   || null,
        duration_hours:  newTask.duration_hours === '' ? null : Number(newTask.duration_hours),
        assigned_emp_id: newTask.assigned_emp_id || null,
        resource_id:     newTask.resource_id    || null,
        notes:           newTask.notes || null,
      });
      newTask = emptyTaskDraft();
      await loadSchedule();
    } catch (e) { jobTasksError = e.message; }
  }

  async function patchTask(t, patch) {
    try {
      await api.updateJobTask(t.id, patch);
      await loadSchedule();
    } catch (e) { jobTasksError = e.message; }
  }
  async function deleteTask(t) {
    if (!confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.deleteJobTask(t.id);
      await loadSchedule();
    } catch (e) { jobTasksError = e.message; }
  }

  // Per-task add-assistant state. Each task gets its own row in this map
  // tracking which employee is selected in the +Add picker.
  let assistPicks = {};
  async function addAssistant(t, empId) {
    const id = Number(empId);
    if (!id) return;
    try {
      await api.addJobTaskAssignee(t.id, id, 'assist');
      assistPicks[t.id] = '';
      await loadSchedule();
    } catch (e) { jobTasksError = e.message; }
  }
  async function removeAssistant(t, empId) {
    try {
      await api.removeJobTaskAssignee(t.id, empId);
      await loadSchedule();
    } catch (e) { jobTasksError = e.message; }
  }
  async function promoteToLead(t, empId) {
    try {
      await api.updateJobTask(t.id, { assigned_emp_id: empId });
      await loadSchedule();
    } catch (e) { jobTasksError = e.message; }
  }
  async function markTaskComplete(t) {
    const today = new Date().toISOString().slice(0, 10);
    await patchTask(t, {
      status: 'completed',
      actual_end: t.actual_end || today,
      actual_start: t.actual_start || t.planned_start || today,
    });
  }
  async function markTaskInProgress(t) {
    const today = new Date().toISOString().slice(0, 10);
    await patchTask(t, {
      status: 'in_progress',
      actual_start: t.actual_start || today,
    });
  }

  async function applyTemplate() {
    if (!applyTemplateId) return;
    try {
      await api.applyTemplate({
        project_id:  Number(id),
        template_id: Number(applyTemplateId),
        anchor:      applyAnchor,
        target_date: applyAnchor === 'target' ? applyTargetDate : undefined,
      });
      applyTemplateId = '';
      await loadSchedule();
    } catch (e) { jobTasksError = e.message; }
  }

  // ─── Mini-Gantt math ───────────────────────────────────────────────
  // Compute a date window that covers all tasks + the job's due date,
  // then bucket tasks into a horizontal bar positioned by date offset.
  function dateMin(...ds) {
    return ds.filter(Boolean).reduce((min, d) => (!min || d < min ? d : min), null);
  }
  function dateMax(...ds) {
    return ds.filter(Boolean).reduce((max, d) => (!max || d > max ? d : max), null);
  }
  $: ganttWindow = (() => {
    if (jobTasks.length === 0) return null;
    let earliest = null, latest = null;
    for (const t of jobTasks) {
      earliest = dateMin(earliest, t.planned_start, t.actual_start);
      latest   = dateMax(latest,   t.planned_end,   t.actual_end);
    }
    if (project?.due_date) latest = dateMax(latest, project.due_date.slice(0, 10));
    if (!earliest || !latest) return null;
    // Pad 2 days each side so bars don't touch the edges.
    const e = new Date(earliest + 'T12:00:00Z'); e.setUTCDate(e.getUTCDate() - 2);
    const l = new Date(latest   + 'T12:00:00Z'); l.setUTCDate(l.getUTCDate() + 2);
    const total = Math.max(1, Math.round((l - e) / 86400000));
    return { start: e, end: l, totalDays: total };
  })();
  function pctForDate(iso) {
    if (!ganttWindow || !iso) return null;
    const d = new Date(iso + 'T12:00:00Z');
    return Math.max(0, Math.min(100, ((d - ganttWindow.start) / 86400000 / ganttWindow.totalDays) * 100));
  }
  function taskBarStyle(t) {
    if (!ganttWindow) return 'display:none';
    const s = pctForDate(t.planned_start);
    // End date is INCLUSIVE — a task with planned_start=2026-06-15 and
    // planned_end=2026-06-16 spans 2 days, not 1. Add a day before
    // converting to a pct so the bar width matches reality.
    const endIso = t.planned_end ? new Date(new Date(t.planned_end + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10) : null;
    const e = pctForDate(endIso);
    if (s == null || e == null) return 'display:none';
    return `left:${s}%; width:${Math.max(1.5, e - s)}%`;
  }
  function ganttDayMarkers() {
    if (!ganttWindow) return [];
    const out = [];
    for (let i = 0; i <= ganttWindow.totalDays; i++) {
      const d = new Date(ganttWindow.start);
      d.setUTCDate(d.getUTCDate() + i);
      if (d.getUTCDay() === 1 || i === 0 || i === ganttWindow.totalDays) {
        out.push({ pct: (i / ganttWindow.totalDays) * 100, label: d.toLocaleDateString('en-CA', { month: 'numeric', day: 'numeric' }) });
      }
    }
    return out;
  }
  function taskKindIcon(kind) {
    switch (kind) {
      case 'customer_wait': return '⏳';
      case 'vendor_wait':   return '📦';
      case 'permit':        return '🏛';
      case 'milestone':     return '🚩';
      default:              return '🔨';
    }
  }
  function taskKindClass(kind) {
    switch (kind) {
      case 'customer_wait': return 'tk-cwait';
      case 'vendor_wait':   return 'tk-vwait';
      case 'permit':        return 'tk-permit';
      case 'milestone':     return 'tk-milestone';
      default:              return 'tk-labor';
    }
  }
  function taskStatusClass(s) {
    return s === 'completed'   ? 'ts-done'
         : s === 'in_progress' ? 'ts-prog'
         : s === 'blocked'     ? 'ts-blk'
         : s === 'skipped'     ? 'ts-skip'
         : 'ts-pend';
  }

  // QuickBooks
  let sendingToQB = false;
  let qbInvoiceId = '';
  const COMPLETE_STATUS_ID = 11;
  $: id = $page.params.id;
  onMount(loadAll);

  async function loadAll() {
    loading = true; error = '';
    try {
      [project, notes, items, photos, statuses, employees, projectTypes, qbItems] = await Promise.all([
        api.getProject(id), api.getNotes(id), api.getItems(id), api.getPhotos(id),
        api.getStatuses(), api.getEmployees(), api.getProjectTypes(),
        fetch(`${API_BASE}/projects/qb-items`).then(r => r.json()).catch(() => [])
      ]);
      newStatusId = project.status_id || '';
      folderPathInput = project.folder_path || '';
      resetEditForm();
    } catch (e) { error = e.message; }
    finally { loading = false; }
    // Load L: drive files via bridge (non-blocking — won't break page load if bridge is down).
    // tick() first: clientFolderName is a reactive value off `project`, and
    // without letting Svelte flush it's still '' here — refreshFiles would
    // bail and the Files card would sit on "No folder on L: yet".
    await tick();
    refreshFiles();
    // Customer ↔ staff chat thread for this project. Independent fetch
    // so a missing/empty thread doesn't block the rest of the page.
    loadMessages();
  }

  async function loadMessages() {
    try {
      const res = await api.getProjectMessages(id);
      messages = res?.messages || [];
    } catch {
      // Silent — the messages tab just shows "no messages" if this fails.
    }
  }

  async function sendStaffMessage() {
    const body = newMessage.trim();
    if (!body || sendingMessage) return;
    sendingMessage = true; messageErr = '';
    try {
      const res = await api.postProjectMessage(id, body);
      messages = [...messages, res.message];
      newMessage = '';
    } catch (e) {
      messageErr = e.message || 'Could not send message.';
    } finally {
      sendingMessage = false;
    }
  }

  function fmtMessageTime(iso) {
    try {
      const d = new Date(iso);
      const sameDay = d.toDateString() === new Date().toDateString();
      return sameDay
        ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return iso; }
  }

  // QB item filtering
  $: filteredQBItems = qbItemSearch
    ? qbItems.filter(i =>
        i.name.toLowerCase().includes(qbItemSearch.toLowerCase()) ||
        (i.category || '').toLowerCase().includes(qbItemSearch.toLowerCase())
      )
    : qbItems;

  $: qbItemsByCategory = filteredQBItems.reduce((acc, item) => {
    const cat = item.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  $: editFilteredQBItems = editQBItemSearch
    ? qbItems.filter(i =>
        i.name.toLowerCase().includes(editQBItemSearch.toLowerCase()) ||
        (i.category || '').toLowerCase().includes(editQBItemSearch.toLowerCase())
      )
    : qbItems;

  $: editQBItemsByCategory = editFilteredQBItems.reduce((acc, item) => {
    const cat = item.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  function selectQBItem(item) {
    newItem.qb_item_name = item.name;
    if (item.price > 0 && !newItem.price) newItem.price = item.price;
    if (item.description) newItem.description = item.description;
    qbItemSearch = item.name;
    showQBDropdown = false;
    if (newItem.qty && newItem.price) {
      newItem.total = (parseFloat(newItem.qty) * parseFloat(newItem.price)).toFixed(2);
    }
  }

  function resetEditForm() {
    editForm = {
      project_name:         project.project_name || '',
      client_id:            project.client_id || '',
      project_type_id:      project.type_id || '',
      status_id:            project.status_id || '',
      assigned_employee_id: project.employee_id || '',
      due_date:             project.due_date ? project.due_date.split('T')[0] : '',
      contact:              project.contact || '',
      contact_phone:        project.contact_phone || '',
      contact_email:        project.contact_email || '',
      po_number:            project.po_number || '',
      folder_path:          project.folder_path || '',
    };
  }

  function startEdit() { resetEditForm(); editing = true; }
  function cancelEdit() { editing = false; }

  async function saveEdit() {
    saving = true;
    try {
      await api.updateProject(id, editForm);
      project = await api.getProject(id);
      folderPathInput = project.folder_path || '';
      editing = false;
    } catch (e) { alert(e.message); }
    finally { saving = false; }
  }

  async function submitNote() {
    if (!newNote.trim()) return;
    addingNote = true;
    try { await api.addNote(id, newNote.trim()); newNote = ''; notes = await api.getNotes(id); }
    catch (e) { alert(e.message); } finally { addingNote = false; }
  }

  async function submitStatus() {
    if (!newStatusId) return;
    changingStatus = true;
    try {
      await api.updateStatus(id, newStatusId, statusNote);
      statusNote = '';
      goto('/dashboard');
    }
    catch (e) { alert(e.message); changingStatus = false; }
  }

  let notifyingPickup = false;
  // Email + text the client that their job is ready for pickup. The backend
  // resolves the destinations (project contact first, then the client account)
  // and reports back per channel; we just confirm and show the result.
  function readableReason(r) {
    return { no_email: 'no email on file', no_phone: 'no phone on file',
             invalid_phone: 'phone number invalid', send_failed: 'failed to send'
           }[r] || r || 'not sent';
  }
  async function notifyPickup() {
    const email = project.contact_email || project.client_email || '';
    const phone = project.contact_phone || '';
    if (!email && !phone) { alert('No email or phone on file for this client.'); return; }
    const lines = ['Notify the client their job is ready for pickup?'];
    if (email) lines.push(`• Email: ${email}`);
    if (phone) lines.push(`• Text: ${phone}`);
    if (!confirm(lines.join('\n'))) return;
    notifyingPickup = true;
    try {
      const r = await api.notifyProjectReady(id, { email: true, sms: true });
      if (!r || (!r.email && !r.sms)) {
        alert('Could not send — you may have been signed out. Please sign in again and retry.');
        return;
      }
      // Refresh the Notes tab so the audit note (who sent it, what went out) shows.
      try { notes = await api.getNotes(id); } catch (_) {}
      const parts = [];
      if (r.email) parts.push(`Email: ${r.email.sent ? '✅ sent to ' + r.email.to : '⚠ ' + readableReason(r.email.reason)}`);
      if (r.sms)   parts.push(`Text: ${r.sms.sent ? '✅ sent to ' + r.sms.to : '⚠ ' + readableReason(r.sms.reason)}`);
      alert(parts.join('\n') || 'Done.');
    } catch (e) { alert(e.message); }
    finally { notifyingPickup = false; }
  }

  // Email the assigned employee a custom message about this job. The backend
  // resolves who's assigned + their email, adds job context, and appends
  // the job link; we just compose and report.
  let showMessageEmployeeModal = false;
  let employeeMessage = '';
  let sendingEmployeeMessage = false;
  async function sendEmployeeMessage() {
    const msg = employeeMessage.trim();
    if (!msg) return;
    sendingEmployeeMessage = true;
    try {
      const r = await api.messageAssignedEmployee(id, msg);
      if (r?.sent) {
        showMessageEmployeeModal = false;
        employeeMessage = '';
        // Refresh the Notes tab so the audit note (who emailed what) shows.
        try { notes = await api.getNotes(id); } catch (_) {}
        alert(`✅ Email sent to ${r.employee_name || 'assignee'} (${r.to})`);
      } else {
        const why = { no_assignee: 'This job has no assigned employee.',
                      no_email: `${r?.employee_name || 'The assignee'} has no email on file.`,
                      send_failed: 'The email failed to send' + (r?.error ? ` (${r.error})` : '') + '.',
                    }[r?.reason] || 'The email was not sent.';
        alert('⚠ ' + why);
      }
    } catch (e) { alert(e.message); }
    finally { sendingEmployeeMessage = false; }
  }

  $: if (newItem.qty && newItem.price) {
    newItem.total = (parseFloat(newItem.qty) * parseFloat(newItem.price)).toFixed(2);
  }

  $: if (editItemForm.qty && editItemForm.price) {
    editItemForm.total = (parseFloat(editItemForm.qty) * parseFloat(editItemForm.price)).toFixed(2);
  }

  async function saveItem() {
    if (!newItem.description.trim()) return;
    savingItem = true;
    try {
      await api.addItem(id, newItem);
      items = await api.getItems(id);
      newItem = { qb_item_name: '', description: '', qty: 1, price: '', total: '' };
      qbItemSearch = '';
      addingItem = false;
    } catch (e) { alert(e.message); }
    finally { savingItem = false; }
  }

  function startItemEdit(item) {
    editingItem = item;
    editQBItemSearch = item.qb_item_name || '';
    editItemForm = {
      qb_item_name: item.qb_item_name || '',
      description: item.item_name || '',
      qty: item.quantity ?? 1,
      price: item.unit_price ?? 0,
      total: item.total ?? 0
    };
  }

  async function saveItemEdit() {
    try {
      await api.updateItem(id, editingItem.id, editItemForm);
      items = await api.getItems(id);
      editingItem = null;
      editQBItemSearch = '';
    } catch (e) { alert(e.message); }
  }

  async function deleteItem(itemId) {
    if (!confirm('Delete this item?')) return;
    try {
      await api.deleteItem(id, itemId);
      items = await api.getItems(id);
    } catch (e) { alert(e.message); }
  }

  async function saveMeasurement() {
    savingMeasurement = true;
    try {
      await api.addMeasurement(id, newMeasurement);
      project = await api.getProject(id);
      newMeasurement = { item: '', width: '', height: '', notes: '' };
      addingMeasurement = false;
    } catch (e) { alert(e.message); }
    finally { savingMeasurement = false; }
  }

  function startEditMeasurement(m) {
    editingMeasurement = m;
    editMeasurementForm = {
      item:   m.item  ?? '',
      width:  m.width === 'NaN' || !Number.isFinite(Number(m.width))  ? '' : m.width,
      height: m.height === 'NaN' || !Number.isFinite(Number(m.height)) ? '' : m.height,
      notes:  m.notes ?? ''
    };
  }

  async function saveMeasurementEdit() {
    savingMeasurementEdit = true;
    try {
      await api.updateMeasurement(id, editingMeasurement.id, editMeasurementForm);
      project = await api.getProject(id);
      editingMeasurement = null;
      editMeasurementForm = {};
    } catch (e) { alert(e.message); }
    finally { savingMeasurementEdit = false; }
  }

  async function deleteMeasurement(mId) {
    if (!confirm('Delete this measurement?')) return;
    try {
      await api.deleteMeasurement(id, mId);
      project = await api.getProject(id);
    } catch (e) { alert(e.message); }
  }

  async function compressImage(file, maxWidth = 1920, quality = 0.85) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  async function handlePhotoUpload(e) {
    const files = e.target.files;
    if (!files?.length) return;
    uploadingPhotos = true;
    try {
      const compressed = await Promise.all(Array.from(files).map(f => compressImage(f)));
      await api.uploadPhotos(id, compressed);
      photos = await api.getPhotos(id);
    } catch (e) { alert(e.message); }
    finally { uploadingPhotos = false; photoInput.value = ''; }
  }

  async function takeJobPhoto() {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera
      });
      const base64 = photo.base64String;
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const compressed = await compressImage(file);
      uploadingPhotos = true;
      await api.uploadPhotos(id, [compressed]);
      photos = await api.getPhotos(id);
    } catch(e) {
      if (e.message !== 'User cancelled photos app') alert(e.message);
    } finally {
      uploadingPhotos = false;
    }
  }

  async function deletePhoto(photo) {
    if (!confirm('Delete this photo?')) return;
    try {
      // Prefer the numeric id; fall back to filename for any legacy photos
      // that haven't been backfilled yet.
      await api.deletePhoto(id, photo.id ?? photo.filename);
      photos = await api.getPhotos(id);
    } catch (e) { alert(e.message); }
  }

  async function updateGallery(photo, patch) {
    try {
      const updated = await api.updatePhoto(id, photo.id, patch);
      photos = photos.map(p => p.id === photo.id ? { ...p, ...updated } : p);
    } catch (e) { alert(e.message); }
  }

  async function saveFolder() {
    savingFolder = true;
    try {
      await api.updateFolderPath(id, folderPathInput);
      project = await api.getProject(id);
      editingFolder = false;
    } catch (e) { alert(e.message); }
    finally { savingFolder = false; }
  }

  async function sendToQuickBooks() {
    if (!confirm(`Send invoice for ${project.client_name} ($${itemTotal.toFixed(2)}) to QuickBooks?`)) return;
    sendingToQB = true;
    try {
      const token = $auth?.token || localStorage.getItem('auth_token') || '';
      const res = await fetch('https://holmgraphics-shop-api-production.up.railway.app/api/quickbooks/invoice/project/' + id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          client_name:    project.client_name,
          client_email:   project.contact_email || '',
          description:    project.project_name,
          project_number: project.id,
          po_number:      project.po_number || '',
          items: items.map(i => ({
            description:  i.item_name || '',
            qty:          i.quantity ?? 1,
            unit_price:   i.unit_price ?? 0,
            total:        i.total ?? 0,
            qb_item_name: i.qb_item_name || ''
          }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      qbInvoiceId = data.invoice_id;

      // Set status to Complete (ID 11)
      await api.updateStatus(id, COMPLETE_STATUS_ID, 'Invoice sent to QuickBooks');

      // Open invoice in QB for review
      window.open(`https://qbo.intuit.com/app/invoice?txnId=${data.invoice_id}`, '_blank');

      // Redirect to dashboard
      goto('/dashboard');

    } catch (e) {
      alert('QuickBooks error: ' + e.message);
    } finally {
      sendingToQB = false;
    }
  }

  function isOverdue(p) {
    if (!p?.due_date) return false;
    return new Date(p.due_date) < new Date() && !(p.status_name || '').toLowerCase().includes('complete');
  }
  function statusCls(name) {
    const s = (name || '').toLowerCase();
    if (s.includes('complete')) return 'badge-complete';
    if (s.includes('pending') || s.includes('wait') || s.includes('proof') || s.includes('billing')) return 'badge-pending';
    if (s.includes('production') || s.includes('design') || s.includes('finish') || s.includes('ordered')) return 'badge-active';
    return 'badge-new';
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function currency(v) { return v != null ? '$' + Number(v).toFixed(2) : '—'; }
  $: itemTotal = (items || []).reduce((sum, i) => sum + (Number(i.total) || 0), 0);

  async function generateQuote() {
    if (!window.jspdf) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const red = [180, 20, 20];
    const dark = [30, 30, 30];
    const pageW = 210;
    const margin = 15;

    doc.setFont('impact', 'Regular');
    doc.setFontSize(24);
    doc.setTextColor(...red);
    doc.text('HOLM', margin, 20);
    doc.setFontSize(18);
    doc.setTextColor(...dark);
    doc.text('Graphics Inc.', margin + 28, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text('2-43 Eastridge Rd.', margin, 27);
    doc.text('Walkerton ON N0G 2V0', margin, 31);
    doc.text('519-507-3001', margin, 35);

    doc.setFillColor(...red);
    doc.rect(pageW - margin - 40, 12, 40, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('Quote', pageW - margin - 20, 21, { align: 'center' });

    doc.setDrawColor(...red);
    doc.setLineWidth(0.8);
    doc.line(margin, 44, pageW - margin, 44);

    doc.setTextColor(...dark);
    doc.setFont('helvetica', 'bold');
doc.setFontSize(9);
    doc.text('Prepared for', margin, 52);
    doc.text('Date', 100, 52);
    doc.text('Quote No', 155, 52);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(project.client_name || '—', margin, 58);
    doc.text(new Date().toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }), 100, 58);
    doc.text(String(project.id), 155, 58);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Description', margin, 68);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(project.project_name || '—', margin, 74);
    // Table geometry. A4 is 297mm tall and the footer strip sits at 280-290,
    // so rows have to stop above bodyBottom and roll onto a new page. Without
    // this, a job with more items than fit on page one lost every row past the
    // bottom edge -- and the totals block with them (job 9198).
    const bodyBottom = 268;
    const tableTop = 84;

    // Column header band. Redrawn at the top of every continuation page so a
    // multi-page quote doesn't leave the customer guessing at the columns.
    function drawTableHead(yPos) {
      doc.setFillColor(30, 30, 30);
      doc.rect(margin, yPos, pageW - margin * 2, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.text('QTY', margin + 3, yPos + 5.5);
      doc.text('DESCRIPTION', margin + 20, yPos + 5.5);
      doc.text('PRICE', 148, yPos + 5.5);
      doc.text('TOTAL', 172, yPos + 5.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...dark);
      return yPos + 8;
    }

    // Slim masthead for pages 2+ -- the full letterhead only belongs on page 1.
    function startContinuationPage() {
      doc.addPage();
      const name = project.project_name || '';
      const contd = `Quote ${project.id}${name ? ' - ' + (name.length > 40 ? name.slice(0, 39) + '…' : name) : ''} (continued)`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...red);
      doc.text('HOLM Graphics Inc.', margin, 18);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120, 120, 120);
      doc.text(contd, pageW - margin, 18, { align: 'right' });
      doc.setDrawColor(...red);
      doc.setLineWidth(0.5);
      doc.line(margin, 21, pageW - margin, 21);
      doc.setTextColor(...dark);
      return 26;
    }

    let y = drawTableHead(tableTop);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...dark);
    items.forEach((item, i) => {
      // Measure first: a wrapped description makes the row taller, and the
      // row has to fit whole on the page before anything is drawn.
      const desc = doc.splitTextToSize(item.item_name || '—', 110);
      const rowH = Math.max(8, desc.length * 5);
      if (y + rowH > bodyBottom) {
        y = drawTableHead(startContinuationPage());
      }
      if (i % 2 === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(margin, y, pageW - margin * 2, rowH, 'F');
      }
      doc.setFontSize(9);
      doc.setTextColor(...dark);
      doc.text(String(item.quantity ?? 1), margin + 3, y + 5.5);
      doc.text(desc, margin + 20, y + 5.5);
      doc.text('$' + Number(item.unit_price || 0).toFixed(2), 148, y + 5.5);
      doc.text('$' + Number(item.total || 0).toFixed(2), 172, y + 5.5);
      y += rowH;
    });

    const subtotal = items.reduce((s, i) => s + Number(i.total || 0), 0);
    const hst = subtotal * 0.13;
    const total = subtotal + hst;

    // Keep the totals block whole -- a subtotal orphaned from its total reads
    // as a truncated quote, which is the whole problem we're fixing. The block
    // is 22mm tall and may sit lower than the rows do (down to totalsBottom),
    // so a quote that just fills page one doesn't push totals onto a page of
    // their own.
    const TOTALS_H = 22;
    const totalsBottom = 276;
    if (y + TOTALS_H > totalsBottom) y = startContinuationPage();
    y += 4;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(140, y, pageW - margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...dark);
    doc.text('Subtotal', 140, y);
    doc.text('$' + subtotal.toFixed(2), 172, y);
    y += 6;
    doc.text('HST', 140, y);
    doc.text('$' + hst.toFixed(2), 172, y);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Total', 140, y);
    doc.text('$' + total.toFixed(2), 172, y);

    // Footer + red bar on every page, plus "Page x of y" once it spans more
    // than one, so the customer can tell nothing is missing.
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text('Thank you for considering Holm Graphics', pageW / 2, 280, { align: 'center' });
      if (pageCount > 1) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`Page ${p} of ${pageCount}`, pageW - margin, 280, { align: 'right' });
      }
      doc.setFillColor(...red);
      doc.rect(0, 284, pageW, 6, 'F');
    }

    // Build the PDF in memory (no Save-As dialog).
    const pdfBlob = doc.output('blob');
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

    // Filename: Quote-<jobid>-YYYYMMDD-HHmm.pdf (timestamp avoids re-quote
    // overwrites — user picked timestamp over versioning).
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `Quote-${project.id}-${ts}.pdf`;

    // 1. Save to the job folder on the NAS (auto-creates client/job folders
    //    if they don't exist yet — no subfolder, lands at the job root).
    let savedPath = null;
    let saveError = null;
    try {
      await ensureJobFolder(project.client_name, project.id, cleanFolderDesc(folderDesc));
      const result = await uploadJobFile(
        project.client_name,
        project.id,
        new File([pdfBlob], filename, { type: 'application/pdf' }),
        { as: filename, desc: cleanFolderDesc(folderDesc) }
      );
      savedPath = result.path;
    } catch (e) {
      saveError = e.message || String(e);
      console.warn('Quote PDF NAS save failed:', saveError);
    }

    // 2. Compute the recipient + email body — the quote is emailed server-side
    //    below (no desktop mail client, so no Thunderbird "Sent folder" errors).
    const subject = `Quote #${project.id} - ${project.project_name || ''}`;
    // Prefer the project's contact_email over the client's billing email.
    // The client.email goes to AP for invoicing; the per-project contact is
    // who actually wants the quote (e.g. a sales manager at the customer).
    // Mirrors the precedence in shop-api's customer-mailer.pickRecipientEmail.
    const recipient = project.contact_email || project.client_email || '';
    const greeting = project.contact || project.client_name || '';
    // Sender info comes from the logged-in staff member so quotes appear
    // to come from whoever sent them. Phone falls back to the shop main
    // line since we don't yet store per-employee phone numbers.
    const senderName  = ($auth?.name  || '').trim() || 'Holm Graphics';
    const senderEmail = ($auth?.email || '').trim() || 'orders@holmgraphics.ca';
    const senderPhone = '519-507-3001';
    const bodyText = [
      `Hi ${greeting},`,
      '',
      `Please find attached your quote for ${project.project_name || ''}.`,
      '',
      `Subtotal: $${subtotal.toFixed(2)}`,
      `HST: $${hst.toFixed(2)}`,
      `Total: $${total.toFixed(2)}`,
      '',
      `Please don't hesitate to contact us if you have any questions.`,
      '',
      `Thank you for considering Holm Graphics!`,
      '',
      senderName,
      `Holm Graphics Inc.`,
      senderPhone,
      senderEmail,
    ].join('\r\n');

    // base64-encode the PDF bytes (chunked to avoid call-stack overflow on
    // large blobs, then wrapped to 76-char lines per RFC 2045).
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < pdfBytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, pdfBytes.subarray(i, i + CHUNK));
    }
    const b64 = btoa(binary);
    // 3. Email the quote server-side (Resend) — the shop sends it directly, so
    //    there's no .eml / mail-client handoff and no "couldn't save to Sent"
    //    error. It fires immediately, so confirm the recipient first.
    if (!recipient) {
      alert(
        `The quote was ${savedPath ? `saved to the job folder:\n${savedPath}\n\n` : 'generated, '}` +
        `but there's no contact or client email on this job, so it can't be emailed. ` +
        `Add a contact/client email and try again.`
      );
      return;
    }
    if (!confirm(`Email this quote to ${recipient}?\n\nIt'll be sent now and you'll be BCC'd a copy.`)) return;
    try {
      const r = await api.emailQuote(project.id, {
        to: recipient,
        subject,
        body: bodyText,
        pdf_base64: b64,
        filename,
      });
      alert(
        `Quote emailed to ${r.sent_to || recipient}. (You're BCC'd a copy.)\n\n` +
        (savedPath
          ? `Also saved to the job folder:\n${savedPath}`
          : `Note: it was NOT saved to the job folder (${saveError || 'unknown error'}).`)
      );
    } catch (e) {
      alert(
        `Quote was NOT emailed: ${e.message || e}\n\n` +
        (savedPath
          ? `It IS saved to the job folder:\n${savedPath}`
          : `And it was not saved to the job folder either (${saveError || 'unknown error'}).`)
      );
    }
  }
</script>

<svelte:head><title>{project?.project_name || 'Job'} — Holm Graphics</title></svelte:head>

{#if lightboxPhoto}
  <div class="lightbox" on:click={() => lightboxPhoto = null}>
    <img src="{lightboxPhoto.url.startsWith('http') ? lightboxPhoto.url : API_BASE.replace('/api','') + lightboxPhoto.url}" alt="Job photo" />
    <button class="lightbox-close" on:click={() => lightboxPhoto = null}>✕</button>
  </div>
{/if}

<div class="page">
  {#if loading}
    <div class="loading-state"><div class="loading-spinner"></div> Loading job…</div>
  {:else if error}
    <div class="error-state">{error} <button class="btn btn-ghost" on:click={loadAll}>Retry</button></div>
  {:else if project}

    <a href="/dashboard" class="back-link">← Job Board</a>

    <div class="job-headline">
      <div class="headline-left">
        <span class="job-id-tag">Job #{project.id}</span>
        <h1 class="job-title">{project.project_name || 'Untitled Job'}</h1>
        <div class="headline-meta">
          <span class="badge {isOverdue(project) ? 'badge-overdue' : statusCls(project.status_name)}">
            {isOverdue(project) ? '⚠ Overdue' : project.status_name || 'Unknown'}
          </span>
          <span class="meta-sep">·</span>
          {#if project.client_id}
            <a class="client-tag client-link" href={`/clients/${project.client_id}`}>{project.client_name || '—'}</a>
          {:else}
            <span class="client-tag">{project.client_name || '—'}</span>
          {/if}
          {#if project.assigned_to && project.assigned_to.trim()}
            <span class="meta-sep">·</span>
            <span class="assigned-tag">👤 {project.assigned_to}</span>
          {/if}
          {#if project.project_type}
            <span class="meta-sep">·</span>
            <span class="type-tag">{project.project_type}</span>
          {/if}
        </div>
      </div>

      <div class="headline-actions">
        {#if $isStaff && !editing}
          <button class="btn btn-ghost" on:click={startEdit}>✏ Edit Job</button>
          <button class="btn btn-ghost" on:click={generateQuote}>📄 Quote</button>
<button class="btn btn-ghost" on:click={() => showLabelModal = true}>🏷 Print Label</button>
          <button class="btn btn-ghost" on:click={sendToQuickBooks} disabled={sendingToQB || itemTotal <= 0}>
            {sendingToQB ? '⏳ Sending…' : qbInvoiceId ? '✅ Sent to QB' : '📊 Send to QB'}
          </button>
        {/if}
        {#if $isStaff}
          <div class="status-change">
            <select bind:value={newStatusId} disabled={changingStatus}>
              <option value="">Change status…</option>
              {#each statuses as s}
                <option value={s.id}>{s.status_name}</option>
              {/each}
            </select>
            {#if newStatusId && newStatusId !== String(project.status_id)}
              <button class="btn btn-primary" on:click={submitStatus} disabled={changingStatus}>Update</button>
            {/if}
          </div>
          <button class="btn btn-ghost" on:click={notifyPickup} disabled={notifyingPickup}>
            {notifyingPickup ? '⏳ Notifying…' : '📣 Notify Pickup'}
          </button>
          {#if project.assigned_to && project.assigned_to.trim()}
            <button class="btn btn-ghost" on:click={() => showMessageEmployeeModal = true}>
              ✉️ Email {project.assigned_to.trim().split(' ')[0]}
            </button>
          {/if}
        {/if}
      </div>
    </div>

    <nav class="tabs">
      {#each ['overview','quoting','schedule','proofs','messages','notes','audit'] as t}
        <button class="tab" class:active={activeTab === t} on:click={() => onTabChange(t)}>
          {t === 'overview' ? 'Overview'
            : t === 'quoting' ? `Quoting${quoteRows.length ? ` (${quoteRows.length})` : ''}`
            : t === 'schedule' ? `Schedule${jobTasks.length ? ` (${jobTasks.length})` : ''}`
            : t === 'proofs' ? `Proofs${proofs.length ? ` (${proofs.length})` : ''}`
            : t === 'messages' ? `Messages (${messages.length})`
            : t === 'notes' ? `Notes (${notes.length})`
            : 'Audit Log'}
        </button>
      {/each}
    </nav>

    {#if activeTab === 'overview'}
      <div class="overview-layout">

        <div class="col-left">
          <div class="card">
            <h2 class="card-title">
              Job Details
              {#if editing}
                <div class="edit-actions">
                  <button class="btn btn-ghost" on:click={cancelEdit} disabled={saving}>Cancel</button>
                  <button class="btn btn-primary" on:click={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              {/if}
            </h2>

            {#if editing}
              <div class="edit-form">
                <div class="form-group">
                  <label>Job Description</label>
                  <input bind:value={editForm.project_name} />
                </div>
                <div class="form-group">
                  <label>Project Type</label>
                  <select bind:value={editForm.project_type_id}>
                    <option value="">— None —</option>
                    {#each projectTypes as t}
                      <option value={t.id}>{t.type_name}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-group">
                  <label>Assigned To</label>
                  <select bind:value={editForm.assigned_employee_id}>
                    <option value="">— Unassigned —</option>
                    {#each employees as e}
                      <option value={e.id}>{e.first_name} {e.last_name}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-group">
                  <label>Due Date</label>
                  <input type="date" bind:value={editForm.due_date} />
                </div>
                <div class="form-group form-section-break">
                  <strong>Project Contact</strong>
                  <div class="muted" style="font-size:0.85em; margin-top:2px;">
                    Overrides the client's bill-to email for proofs, status updates,
                    and ready-for-pickup notifications. Leave blank to fall back to
                    {project.client_email ? project.client_email : 'the client’s billing email'}.
                  </div>
                </div>
                <div class="form-group">
                  <label>Contact Name</label>
                  <input bind:value={editForm.contact} placeholder={project.client_name || ''} />
                </div>
                <div class="form-group">
                  <label>Contact Phone</label>
                  <input bind:value={editForm.contact_phone} />
                </div>
                <div class="form-group">
                  <label>Contact Email</label>
                  <input bind:value={editForm.contact_email} type="email" />
                </div>
                <div class="form-group">
                  <label>PO #</label>
                  <input bind:value={editForm.po_number} placeholder="Customer purchase order #" />
                </div>
                <div class="form-group">
                  <label>Client Folder Path (L:\)</label>
                  <input bind:value={editForm.folder_path} placeholder="e.g. L:\ClientFilesA-K\HuronBayCoop\Job3518" />
                </div>
              </div>
            {:else}
              <table class="detail-table">
                <tbody>
                  <tr><td>Client</td><td>{project.client_name || '—'}</td></tr>
                  {#if project.client_email}
                    <tr>
                      <td>Bill-to</td>
                      <td>
                        <a href="mailto:{project.client_email}">{project.client_email}</a>
                        <span class="muted" style="font-size:0.85em; margin-left:6px;">(client account — used for invoices &amp; receipts)</span>
                      </td>
                    </tr>
                  {/if}
                  <tr><td>Type</td><td>{project.project_type || '—'}</td></tr>
                  <tr><td>Status</td><td><span class="badge {statusCls(project.status_name)}">{project.status_name || '—'}</span></td></tr>
                  <tr><td>Assigned</td><td>{project.assigned_to || '—'}</td></tr>
                  <tr><td>Created</td><td>{fmtDate(project.date_created)}</td></tr>
                  <tr><td>Due Date</td><td class:overdue-cell={isOverdue(project)}>{fmtDate(project.due_date)}</td></tr>
                  {#if project.po_number}<tr><td>PO #</td><td class="mono">{project.po_number}</td></tr>{/if}
                  {#if project.contact || project.contact_phone || project.contact_email}
                    <tr><td colspan="2" style="padding-top:14px;"><strong>Project Contact</strong> <span class="muted" style="font-size:0.85em;">(overrides bill-to for proofs / status / pickup)</span></td></tr>
                  {/if}
                  {#if project.contact}<tr><td>Name</td><td>{project.contact}</td></tr>{/if}
                  {#if project.contact_phone}<tr><td>Phone</td><td><a href="tel:{project.contact_phone}">{project.contact_phone}</a></td></tr>{/if}
                  {#if project.contact_email}<tr><td>Email</td><td><a href="mailto:{project.contact_email}">{project.contact_email}</a></td></tr>{/if}
                  {#if project.folder_path}
                    <tr>
                      <td>Folder</td>
                      <td>
                        <a href="file:///{project.folder_path.replace(/\\/g, '/')}" class="folder-link" title="{project.folder_path}">
                          📁 {project.folder_path.split('\\').pop()}
                        </a>
                      </td>
                    </tr>
                  {/if}
                </tbody>
              </table>
              {#if $isStaff && !project.folder_path}
                <button class="btn-link" style="margin-top:8px" on:click={() => editing = true}>+ Add folder path</button>
              {/if}
            {/if}
          </div>

          <div class="card">
            <h2 class="card-title">Measurements</h2>
            {#if project.measurements && project.measurements.length > 0}
              <table class="items-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>W (in)</th>
                    <th>H (in)</th>
                    <th>Notes</th>
                    {#if $isStaff}<th style="width:90px"></th>{/if}
                  </tr>
                </thead>
                <tbody>
                  {#each project.measurements as m}
                    {#if editingMeasurement && editingMeasurement.id === m.id}
                      <tr>
                        <td colspan={$isStaff ? 5 : 4}>
                          <div class="add-item-form" style="margin:0">
                            <div class="form-group">
                              <label>Item / Description</label>
                              <input bind:value={editMeasurementForm.item} placeholder="e.g. Front sign" />
                            </div>
                            <div class="item-row">
                              <div class="form-group">
                                <label>Width (in)</label>
                                <input type="number" step="0.001" bind:value={editMeasurementForm.width} placeholder="48" />
                              </div>
                              <div class="form-group">
                                <label>Height (in)</label>
                                <input type="number" step="0.001" bind:value={editMeasurementForm.height} placeholder="24" />
                              </div>
                            </div>
                            <div class="form-group">
                              <label>Notes</label>
                              <input bind:value={editMeasurementForm.notes} placeholder="Material, finish…" />
                            </div>
                            <div class="item-form-actions">
                              <button class="btn btn-ghost"   on:click={() => { editingMeasurement = null; }}>Cancel</button>
                              <button class="btn btn-primary" on:click={saveMeasurementEdit} disabled={savingMeasurementEdit}>
                                {savingMeasurementEdit ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    {:else}
                      <tr>
                        <td>{m.item || '—'}</td>
                        <td>{fmtDim(m.width)}</td>
                        <td>{fmtDim(m.height)}</td>
                        <td class="text-muted">{m.notes || '—'}</td>
                        {#if $isStaff}
                          <td style="text-align:right; white-space:nowrap">
                            <button class="btn-link" title="Edit"   on:click={() => startEditMeasurement(m)}>Edit</button>
                            <button class="btn-link" title="Delete" style="color:#b00020" on:click={() => deleteMeasurement(m.id)}>Delete</button>
                          </td>
                        {/if}
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            {:else}
              <p class="empty-msg">No measurements recorded.</p>
            {/if}

            {#if $isStaff}
              {#if addingMeasurement}
                <div class="add-item-form">
                  <h3 class="add-item-title">Add Measurement</h3>
                  <div class="form-group">
                    <label>Item / Description</label>
                    <input bind:value={newMeasurement.item} placeholder="e.g. Front sign" />
                  </div>
                  <div class="item-row">
                    <div class="form-group">
                      <label>Width (in)</label>
                      <input type="number" step="0.001" bind:value={newMeasurement.width} placeholder="48" />
                    </div>
                    <div class="form-group">
                      <label>Height (in)</label>
                      <input type="number" step="0.001" bind:value={newMeasurement.height} placeholder="24" />
                    </div>
                  </div>
                  <div class="form-group">
                    <label>Notes</label>
                    <input bind:value={newMeasurement.notes} placeholder="Material, finish…" />
                  </div>
                  <div class="item-form-actions">
                    <button class="btn btn-ghost" on:click={() => addingMeasurement = false}>Cancel</button>
                    <button class="btn btn-primary" on:click={saveMeasurement} disabled={savingMeasurement}>
                      {savingMeasurement ? 'Saving…' : 'Add'}
                    </button>
                  </div>
                </div>
              {:else}
                <button class="btn btn-ghost add-item-btn" on:click={() => addingMeasurement = true}>+ Add Measurement</button>
              {/if}
            {/if}
          </div>

          {#if notes.length > 0}
            <div class="card">
              <h2 class="card-title">Recent Notes</h2>
              {#each notes.slice(0, 3) as note}
                <div class="note-snippet">
                  <span class="note-date">{fmtDateTime(note.note_date)}</span>
                  <p>{note.note_text}</p>
                </div>
              {/each}
              {#if notes.length > 3}
                <button class="btn btn-ghost" style="width:100%;margin-top:8px" on:click={() => activeTab='notes'}>
                  View all {notes.length} notes →
                </button>
              {/if}
            </div>
          {/if}
        </div>

        <div class="col-right">
          <div class="card">
            <h2 class="card-title">
              Line Items
              {#if items.length > 0}<span class="item-total">{currency(itemTotal)}</span>{/if}
            </h2>
            {#if items.length > 0}
              <table class="items-table">
                <thead>
                  <tr>
                    <th style="min-width:150px">QB Item</th><th>Description</th><th>Qty</th><th>Price</th><th>Total</th>
                    {#if $isStaff}<th></th>{/if}
                  </tr>
                </thead>
                <tbody>
                  {#each items as item}
                    {#if editingItem?.id === item.id}
                      <tr>
                        <td style="position:relative; min-width:150px">
                          <input
                            bind:value={editQBItemSearch}
                            placeholder="QB item…"
                            on:focus={() => showEditQBDropdown = true}
                            on:blur={() => setTimeout(() => showEditQBDropdown = false, 200)}
                          />
                          {#if showEditQBDropdown && Object.keys(editQBItemsByCategory).length > 0}
                            <div class="qb-dropdown">
                              {#each Object.entries(editQBItemsByCategory) as [cat, catItems]}
                                <div class="qb-dropdown-category">{cat}</div>
                                {#each catItems as qbItem}
                                  <div class="qb-dropdown-item" on:mousedown={() => {
                                    editItemForm.qb_item_name = qbItem.name;
                                    editQBItemSearch = qbItem.name;
                                    if (qbItem.price > 0 && !editItemForm.price) editItemForm.price = qbItem.price;
                                    showEditQBDropdown = false;
                                  }}>
                                    <span class="qb-item-name">{qbItem.name}</span>
                                    {#if qbItem.price > 0}<span class="qb-item-price">${qbItem.price}</span>{/if}
                                  </div>
                                {/each}
                              {/each}
                            </div>
                          {/if}
                        </td>
                        <td><input bind:value={editItemForm.description} /></td>
                        <td><input type="number" bind:value={editItemForm.qty} step="0.01" style="width:60px" /></td>
                        <td><input type="number" bind:value={editItemForm.price} step="0.01" style="width:80px" /></td>
                        <td><input type="number" bind:value={editItemForm.total} step="0.01" style="width:80px" /></td>
                        {#if $isStaff}
                          <td>
                            <div style="display:flex;gap:4px">
                              <button class="btn btn-primary" style="padding:4px 8px;font-size:0.75rem" on:click={saveItemEdit}>Save</button>
                              <button class="btn btn-ghost" style="padding:4px 8px;font-size:0.75rem" on:click={() => editingItem = null}>Cancel</button>
                            </div>
                          </td>
                        {/if}
                      </tr>
                    {:else}
                      <tr>
                        <td class="text-muted" style="font-size:0.82rem">
                          {#if item.source === 'order'}
                            <span title="Line item from the customer's online order — edit via order admin." style="display:inline-block;padding:2px 6px;border-radius:4px;background:#dbeafe;color:#1e40af;font-size:0.7rem;font-weight:600;letter-spacing:0.04em;">ONLINE</span>
                          {:else}
                            {item.qb_item_name || ''}
                          {/if}
                        </td>
                        <td>{item.item_name || '—'}</td>
                        <td>{item.quantity ?? '—'}</td>
                        <td>{currency(item.unit_price)}</td>
                        <td class="total-cell">{currency(item.total)}</td>
                        {#if $isStaff}
                          <td>
                            {#if item.source !== 'order'}
                              <div class="item-actions">
                                <button class="btn-icon" title="Edit" on:click={() => startItemEdit(item)}>✏</button>
                                <button class="btn-icon btn-icon-danger" title="Delete" on:click={() => deleteItem(item.id)}>✕</button>
                              </div>
                            {/if}
                          </td>
                        {/if}
                      </tr>
                    {/if}
                  {/each}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan={$isStaff ? 4 : 4} class="tfoot-label">Total</td>
                    <td class="tfoot-total">{currency(itemTotal)}</td>
                    {#if $isStaff}<td></td>{/if}
                  </tr>
                </tfoot>
              </table>
            {:else}
              <p class="empty-msg">No items recorded.</p>
            {/if}

            {#if $isStaff}
              {#if addingItem}
                <div class="add-item-form">
                  <h3 class="add-item-title">Add Item</h3>

                  <div class="form-group" style="position:relative">
                    <label>QB Item</label>
                    <input
                      bind:value={qbItemSearch}
                      placeholder="Search QB items…"
                      on:focus={() => showQBDropdown = true}
                      on:blur={() => setTimeout(() => showQBDropdown = false, 200)}
                    />
                    {#if showQBDropdown && Object.keys(qbItemsByCategory).length > 0}
                      <div class="qb-dropdown">
                        {#each Object.entries(qbItemsByCategory) as [cat, catItems]}
                          <div class="qb-dropdown-category">{cat}</div>
                          {#each catItems as qbItem}
                            <div class="qb-dropdown-item" on:mousedown={() => selectQBItem(qbItem)}>
                              <span class="qb-item-name">{qbItem.name}</span>
                              {#if qbItem.price > 0}
                                <span class="qb-item-price">${qbItem.price}</span>
                              {/if}
                            </div>
                          {/each}
                        {/each}
                      </div>
                    {/if}
                  </div>

                  <div class="form-group">
                    <label>Description</label>
                    <input bind:value={newItem.description} placeholder="Item description…" />
                  </div>

                  <div class="item-row">
                    <div class="form-group">
                      <label>Qty</label>
                      <input type="number" bind:value={newItem.qty} min="0.01" step="0.01" />
                    </div>
                    <div class="form-group">
                      <label>Unit Price</label>
                      <input type="number" bind:value={newItem.price} min="0" step="0.01" placeholder="0.00" />
                    </div>
                    <div class="form-group">
                      <label>Total</label>
                      <input type="number" bind:value={newItem.total} step="0.01" placeholder="0.00" />
                    </div>
                  </div>
                  <div class="item-form-actions">
                    <button class="btn btn-ghost" on:click={() => { addingItem = false; qbItemSearch = ''; }}>Cancel</button>
                    <button class="btn btn-primary" on:click={saveItem} disabled={savingItem || !newItem.description.trim()}>
                      {savingItem ? 'Saving…' : 'Add Item'}
                    </button>
                  </div>
                </div>
              {:else}
                <div class="item-add-row">
                  <button class="btn btn-ghost add-item-btn" on:click={() => addingItem = true}>+ Add Item</button>
                  <a class="btn btn-ghost add-item-btn" href={`/admin/led-quote?job=${id}`} title="Open the LED Sign Quote tool — generated line item will be written back to this job">
                    LED Sign Quote →
                  </a>
                </div>
              {/if}
            {/if}
          </div>

          <!-- Financial summary: the breakdown the customer saw at checkout.
               Renders only when the project links to an online order (the
               API omits order_summary entirely for staff-created jobs, so
               this section never shows on those). Tax rate is derived from
               actual tax / pre-tax totals on the API side; we just render
               it. -->
          {#if $isStaff && project.order_summary}
            <div class="card">
              <h2 class="card-title">
                Financial summary
                <span class="photo-count">#{project.order_summary.order_number}</span>
              </h2>
              <table class="finsum">
                <tbody>
                  <tr>
                    <td class="k">Subtotal (garments)</td>
                    <td class="v">{currency(project.order_summary.items_subtotal)}</td>
                  </tr>
                  {#if project.order_summary.decorations_subtotal != null}
                    <tr>
                      <td class="k">Decorations</td>
                      <td class="v">{currency(project.order_summary.decorations_subtotal)}</td>
                    </tr>
                  {/if}
                  {#if project.order_summary.shipping_total > 0}
                    <tr>
                      <td class="k">Shipping ({project.order_summary.fulfillment_method})</td>
                      <td class="v">{currency(project.order_summary.shipping_total)}</td>
                    </tr>
                  {/if}
                  <tr>
                    <td class="k">Tax ({project.order_summary.tax_rate_pct}%)</td>
                    <td class="v">{currency(project.order_summary.tax_total)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="finsum-total">
                    <td class="k">Grand total</td>
                    <td class="v">{currency(project.order_summary.grand_total)}</td>
                  </tr>
                </tfoot>
              </table>
              <dl class="finsum-meta">
                <div class="finsum-meta-row">
                  <dt>Paid</dt>
                  <dd>
                    {project.order_summary.paid_at
                      ? new Date(project.order_summary.paid_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
                      : '—'}
                    {#if project.order_summary.payment_card_last4}
                      via card ending {project.order_summary.payment_card_last4}
                    {:else}
                      via online payment
                    {/if}
                  </dd>
                </div>
                {#if project.order_summary.qb_payment_id}
                  <div class="finsum-meta-row">
                    <dt>QB ref</dt>
                    <dd class="mono">{project.order_summary.qb_payment_id}</dd>
                  </div>
                {/if}
                {#if project.order_summary.notification_email}
                  <div class="finsum-meta-row">
                    <dt>Notification email</dt>
                    <dd><a href="mailto:{project.order_summary.notification_email}">{project.order_summary.notification_email}</a></dd>
                  </div>
                {/if}
              </dl>
            </div>
          {/if}

          <!-- Decorations: one row per checkout-time decoration (position +
               design + uploaded artwork). Only renders when the API returns
               at least one row -- staff-created jobs (no online order) skip
               the section cleanly. Each row links straight to the artwork
               file via the holm:// protocol so clicking opens it in the
               default Windows program (CorelDraw / Illustrator / etc). -->
          {#if $isStaff && project.decorations && project.decorations.length > 0}
            <div class="card">
              <h2 class="card-title">
                Decorations
                <span class="photo-count">{project.decorations.length}</span>
              </h2>
              <ul class="decoration-list">
                {#each project.decorations as dec (dec.id)}
                  <li class="decoration-row">
                    <div class="decoration-header">
                      <span class="decoration-position">{dec.position_name || 'Custom location'}</span>
                      {#if dec.width_in && dec.height_in}
                        <span class="decoration-dims">{dec.width_in}″ × {dec.height_in}″</span>
                      {/if}
                    </div>
                    {#if dec.design_name}
                      <div class="decoration-design">{dec.design_name}</div>
                    {/if}
                    {#if dec.artwork_path}
                      <a class="decoration-link"
                         href={holmUrl(dec.artwork_path)}
                         title={`Open: ${dec.artwork_path}`}>
                        <span class="file-icon">🎨</span>
                        <span class="file-name">{dec.artwork_filename || 'Open artwork'}</span>
                      </a>
                    {:else}
                      <p class="decoration-pending">Awaiting artwork upload from customer.</p>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if $isStaff}
            <div class="card">
              <h2 class="card-title">
                Files
                {#if filesData.resolved && filesData.entries}
                  <span class="photo-count">{filesData.entries.filter(e => e.type === 'file').length}</span>
                {/if}
                {#if project.client_folder_override}
                  <span class="photo-count" title="Folder is a manual override — click “Match folder” to change">
                    📌 manual
                  </span>
                {/if}
                <div class="edit-actions">
                  <button
                    class="btn btn-ghost"
                    on:click={openUploadLinkModal}
                    title="Email a public upload link to the client"
                  >
                    📨 Send upload link
                  </button>
                  <button
                    class="btn btn-ghost"
                    on:click={() => showFolderModal = true}
                    title="Pick which L:\ folder this client maps to"
                  >
                    📁 Match folder
                  </button>
                  <button class="btn btn-ghost" on:click={refreshFiles} disabled={filesLoading} title="Refresh">
                    {filesLoading ? '…' : '⟳'}
                  </button>
                </div>
              </h2>

              {#if filesLoading && !filesData.entries?.length}
                <p class="empty-msg">Loading files…</p>
              {:else if filesError}
                <p class="empty-msg" style="color:#dc2626;">⚠ {filesError}</p>
                <button class="btn btn-ghost add-item-btn" on:click={refreshFiles}>Try again</button>
              {:else if !filesData.resolved}
                <p class="empty-msg">
                  No folder on L: yet for this job{#if filesData.clientFolder}&nbsp;(client folder <span class="mono">{filesData.clientFolder}</span> exists, but no <span class="mono">Job{project.id}</span> subfolder){/if}.
                  {#if !filesData.clientFolder}
                    <br><br>
                    Looking for <span class="mono">{clientFolderName}</span>. If the folder exists under a different name, click <strong>Match folder</strong> above.
                  {/if}
                </p>
                <div class="folder-create">
                  <label class="folder-create-label" for="folder-desc-{project.id}">
                    Folder name — say what the job is, so it reads right in Explorer
                  </label>
                  <div class="folder-create-row">
                    <span class="folder-prefix mono">Job{project.id} -</span>
                    <input
                      id="folder-desc-{project.id}"
                      class="folder-desc-input"
                      bind:value={folderDesc}
                      placeholder="e.g. Truck Letters"
                    />
                    <button class="btn btn-ghost" on:click={createJobFolder} disabled={creatingFolder}>
                      {creatingFolder ? 'Creating…' : '📁 Create folder on L:'}
                    </button>
                  </div>
                  <p class="folder-create-hint">
                    Creates <span class="mono">{newFolderName}</span>
                  </p>
                  {#if bridgeStale}
                    <p class="folder-create-warn">
                      ⚠ The files bridge on the RIP computer is out of date — it will create a bare
                      <span class="mono">Job{project.id}</span> folder and drop the description.
                      Update it (see files-bridge/README.md) to get named folders.
                    </p>
                  {/if}
                </div>
              {:else if filesData.entries.length === 0}
                <p class="empty-msg">
                  Folder is empty. Drop files here on the RIP:
                </p>
                <a class="folder-path mono" href={holmUrl(filesData.jobPath)} title={`Open in Explorer: ${filesData.jobPath}`}>{filesData.jobPath}</a>
              {:else}
                <ul class="file-list">
                  {#each filesData.entries as entry}
                    {#if entry.type === 'dir'}
                      <li class="file-row folder-row">
                        <a class="file-link" href={holmUrl(entryPath(entry))} title={`Open in Explorer: ${entryPath(entry)}`}>
                          <span class="file-icon">📁</span>
                          <span class="file-name">{entry.name}</span>
                          <span class="file-meta">subfolder</span>
                        </a>
                      </li>
                    {:else}
                      <li class="file-row">
                        <a class="file-link" href={holmUrl(entry.path)} title={`Open: ${entry.path}`}>
                          <span class="file-icon">{fileIcon(entry.name)}</span>
                          <span class="file-name">{entry.name}</span>
                          <span class="file-meta">{formatBytes(entry.size)} · {formatFileDate(entry.mtime)}</span>
                        </a>
                        <button class="file-download" on:click={() => downloadBridgeEntry(entry)} title="Download">⬇</button>
                      </li>
                    {/if}
                  {/each}
                </ul>
                <a class="folder-path mono" href={holmUrl(filesData.jobPath)} title={`Open in Explorer: ${filesData.jobPath}`}>{filesData.jobPath}</a>
              {/if}
            </div>
          {/if}

          <div class="card">
            <h2 class="card-title">
              Photos
              {#if photos.length > 0}<span class="photo-count">{photos.length}</span>{/if}
            </h2>

            {#if photos.length > 0}
              <div class="photo-grid">
                {#each photos as photo}
                  <div class="photo-thumb">
                    <img
                      src="{photo.url.startsWith('http') ? photo.url : API_BASE.replace('/api','') + photo.url}"
                      alt="Job photo"
                      on:click={() => lightboxPhoto = photo}
                    />
                    {#if $isStaff}
                      <button class="photo-delete" on:click={() => deletePhoto(photo)}>✕</button>
                      <div class="photo-gallery-controls">
                        <label class="gallery-check">
                          <input
                            type="checkbox"
                            checked={photo.show_in_gallery}
                            disabled={!$isAdmin}
                            on:change={(e) => updateGallery(photo, { show_in_gallery: e.target.checked })}
                          />
                          Gallery
                        </label>
                        <select
                          class="gallery-cat"
                          value={photo.category || 'other'}
                          disabled={!$isAdmin}
                          on:change={(e) => updateGallery(photo, { category: e.target.value })}
                        >
                          <option value="other">Category…</option>
                          <option value="signs_led">Signs &amp; LED</option>
                          <option value="vehicle_wraps">Vehicle Wraps</option>
                          <option value="apparel">Apparel</option>
                          <option value="printing">Printing</option>
                        </select>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="empty-msg">No photos uploaded.</p>
            {/if}

            {#if $isStaff}
              <input
                type="file"
                accept="image/*"
                multiple
                bind:this={photoInput}
                on:change={handlePhotoUpload}
                style="display:none"
              />
              <button
                class="btn btn-ghost add-item-btn"
                on:click={() => photoInput.click()}
                disabled={uploadingPhotos}
              >
                {uploadingPhotos ? 'Uploading…' : '📷 Upload Photos'}
              </button>
              <button
                class="btn btn-ghost add-item-btn"
                on:click={takeJobPhoto}
                disabled={uploadingPhotos}
              >
                📸 Take Photo
              </button>
            {/if}
          </div>
        </div>
      </div>

    {:else if activeTab === 'quoting'}
      <div class="quoting-panel">
        <div class="card">
          <div class="card-title-row">
            <h2 class="card-title" style="border:none;margin:0;">Quote sheet</h2>
            <div class="quote-actions">
              <button class="btn btn-ghost" on:click={addQuoteRow}>+ Add row</button>
              <button class="btn btn-primary" on:click={promoteQuote} disabled={promotingQuote || quoteRows.length === 0}>
                {promotingQuote ? 'Promoting…' : '→ Promote to Items'}
              </button>
            </div>
          </div>
          <p class="empty-msg" style="margin:0 0 12px;color:#888;font-size:0.9em;">
            Internal worksheet. Enter your cost and a markup (defaults to 2× = 100% margin); sale price auto-fills but is editable.
            "Promote to Items" copies these rows into the Items tab at sale price for invoicing.
          </p>
          {#if quoteError}
            <p class="error-state">{quoteError}</p>
          {/if}
          {#if quoteLoading && quoteRows.length === 0}
            <p class="empty-msg">Loading…</p>
          {:else if quoteRows.length === 0}
            <p class="empty-msg">No rows yet. Click <strong>+ Add row</strong> to start.</p>
          {:else}
            <table class="quote-table">
              <thead>
                <tr>
                  <th class="qt-item">Item</th>
                  <th class="qt-num">Qty</th>
                  <th class="qt-num">Cost / unit</th>
                  <th class="qt-num">Markup</th>
                  <th class="qt-num">Sale / unit</th>
                  <th class="qt-num">Total</th>
                  <th class="qt-x"></th>
                </tr>
              </thead>
              <tbody>
                {#each quoteRows as row (row.id)}
                  <tr>
                    <td>
                      <input class="cell" type="text" bind:value={row.item}
                        on:change={() => saveQuoteField(row, 'item')} placeholder="e.g. 4x8 ACM panel" />
                    </td>
                    <td>
                      <input class="cell num" type="number" min="0" step="0.01" bind:value={row.qty}
                        on:input={bumpTotals} on:change={() => saveQuoteField(row, 'qty')} />
                    </td>
                    <td>
                      <input class="cell num" type="number" min="0" step="0.01" bind:value={row.cost_per_unit}
                        on:input={() => recomputeSale(row)} on:change={() => saveQuoteField(row, 'cost_per_unit', true)} />
                    </td>
                    <td>
                      <input class="cell num" type="number" min="0" step="0.001" bind:value={row.markup}
                        on:input={() => recomputeSale(row)} on:change={() => saveQuoteField(row, 'markup', true)} />
                    </td>
                    <td>
                      <input class="cell num" type="number" min="0" step="0.01" bind:value={row.sale_per_unit}
                        on:input={bumpTotals} on:change={() => saveQuoteField(row, 'sale_per_unit')} />
                    </td>
                    <td class="cell-total">{fmtMoney(rowTotal(row))}</td>
                    <td>
                      <button class="row-x" title="Delete row" on:click={() => removeQuoteRow(row)}>×</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5" class="grand-label">Project total</td>
                  <td class="grand-total">{fmtMoney(quoteGrandTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          {/if}
        </div>
      </div>

    {:else if activeTab === 'schedule'}
      <div class="schedule-tab">
        {#if jobTasksError}<div class="error inline">{jobTasksError}</div>{/if}
        {#if jobTasksLoading}<p class="muted">Loading schedule…</p>{/if}

        <!-- ─── Phases checklist (event-driven schedule) ───────────────
             High-level checklist with one active phase at a time.
             Check off → next phase auto-activates with started_at=now;
             staff sets the days budgeted for the upcoming phase at
             handoff. The bar(s) below show day-budget vs day-elapsed
             so a customer who's gone quiet for 8 days on a 2-day
             phase is immediately visible. -->
        <div class="card">
          <h2 class="card-title">
            Phases
            {#if phases.length > 0}
              {@const active = phases.find((p) => p.status === 'active')}
              {#if active}
                <span class="phase-ball" style="background:{partyColor(active.responsible_party)}">
                  {partyIcon(active.responsible_party)} Ball in court: {partyLabel(active.responsible_party)}
                </span>
              {/if}
            {/if}
            {#if phases.length === 0}
              <button class="btn btn-primary" style="float:right" on:click={() => (pickingPhaseTemplate = true)}>+ Set up phases</button>
            {:else}
              <button class="btn btn-ghost" style="float:right;font-size:0.85em" on:click={() => (pickingPhaseTemplate = true)}>Reset</button>
            {/if}
          </h2>

          {#if pickingPhaseTemplate}
            <div class="phase-picker">
              <p class="muted small">Pick a phase template — sets the standard handoffs for this job type. You can edit individual phases after.</p>
              <select bind:value={phaseTemplateChoice}>
                <option value="">— pick template —</option>
                {#each phaseTemplates as t}
                  <option value={t.id}>{t.name} ({t.steps.length} phases)</option>
                {/each}
              </select>
              <button class="btn btn-primary" on:click={applyPhaseTemplate} disabled={!phaseTemplateChoice}>Apply</button>
              <button class="btn btn-ghost" on:click={() => { pickingPhaseTemplate = false; phaseTemplateChoice = ''; }}>Cancel</button>
            </div>
          {/if}

          {#if phases.length === 0 && !pickingPhaseTemplate}
            <p class="muted">No phases yet. Pick a template to start.</p>
          {/if}

          {#if phases.length > 0}
            <ol class="phase-list">
              {#each phases as p (p.id)}
                {@const overdue = p.status === 'active' && p.expected_days && p.days_active != null && p.days_active > p.expected_days}
                <li class="phase-item phase-{p.status}" class:overdue>
                  <div class="phase-row">
                    <div class="phase-icon" style="background:{partyColor(p.responsible_party)}">
                      {partyIcon(p.responsible_party)}
                    </div>
                    <div class="phase-body">
                      <div class="phase-head">
                        <strong>{p.name}</strong>
                        <span class="phase-party muted small">· {partyLabel(p.responsible_party)}</span>
                      </div>
                      <div class="phase-meta muted small">
                        {#if p.status === 'active'}
                          {p.days_active}d elapsed
                          {#if p.expected_days} / {p.expected_days}d allowed{/if}
                          {#if p.expected_end_date} · target {new Date(p.expected_end_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}{/if}
                          {#if overdue}<span class="overdue-flag"> ⚠ overdue</span>{/if}
                        {:else if p.status === 'completed'}
                          ✓ completed {p.completed_at ? new Date(p.completed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : ''}
                        {:else if p.status === 'skipped'}
                          skipped
                        {:else if p.expected_days}
                          pending · {p.expected_days}d budget
                        {:else}
                          pending
                        {/if}
                      </div>
                    </div>
                    <div class="phase-actions">
                      {#if p.status === 'active'}
                        <button class="btn btn-primary" on:click={() => openCompletePhase(p)}>✓ Complete</button>
                        <button class="btn btn-ghost" on:click={() => skipPhase(p)}>Skip</button>
                      {/if}
                      <button class="btn btn-ghost" on:click={() => openEditPhase(p)} title="Edit phase">⚙</button>
                      {#if p.status === 'pending'}
                        <button class="btn btn-ghost" on:click={() => deletePhase(p)} title="Delete">×</button>
                      {/if}
                    </div>
                  </div>
                  {#if p.status === 'active' && p.expected_days}
                    <div class="phase-progress">
                      <div class="phase-progress-fill"
                           style="width:{Math.min(100, ((p.days_active || 0) / Number(p.expected_days)) * 100)}%;background:{overdue ? '#dc2626' : partyColor(p.responsible_party)}"></div>
                    </div>
                  {/if}
                </li>
              {/each}
            </ol>
          {/if}
        </div>

        {#if jobTasks.length === 0 && !jobTasksLoading}
          <div class="card">
            <h2 class="card-title">Apply a template</h2>
            <p class="muted small">
              Start by picking a sign-type template — it generates the standard
              task list (design, proof, production, install) scheduled backwards
              from the job's due date.
            </p>
            <div class="apply-row">
              <select bind:value={applyTemplateId}>
                <option value="">— pick template —</option>
                {#each taskTemplates as t}
                  <option value={t.id}>{t.name} ({t.step_count} steps)</option>
                {/each}
              </select>
              <select bind:value={applyAnchor}>
                <option value="due_date">Anchor: due date</option>
                <option value="install_date">Anchor: install date</option>
                <option value="target">Anchor: specific date</option>
              </select>
              {#if applyAnchor === 'target'}
                <input type="date" bind:value={applyTargetDate} />
              {/if}
              <button class="btn btn-primary" on:click={applyTemplate} disabled={!applyTemplateId}>Apply</button>
            </div>
          </div>
        {/if}

        {#if jobTasks.length > 0}
          <div class="card">
            <h2 class="card-title">
              Timeline
              {#if project?.due_date}
                <span class="muted small" style="float:right">Due: {new Date(project.due_date).toLocaleDateString('en-CA')}</span>
              {/if}
            </h2>

            <!-- Mini-Gantt ---------------------------------------------------- -->
            <div class="gantt">
              <div class="gantt-axis">
                {#each ganttDayMarkers() as m}
                  <div class="gantt-tick" style="left:{m.pct}%">{m.label}</div>
                {/each}
                {#if project?.due_date && ganttWindow}
                  {@const duePct = pctForDate(project.due_date.slice(0, 10))}
                  {#if duePct != null}
                    <div class="gantt-due-line" style="left:{duePct}%" title="Due {project.due_date.slice(0,10)}">Due</div>
                  {/if}
                {/if}
              </div>
              <div class="gantt-rows">
                {#each jobTasks as t (t.id)}
                  <div class="gantt-row">
                    <div class="gantt-label">
                      <span class="kind-icon">{taskKindIcon(t.task_kind)}</span>
                      {t.name}
                    </div>
                    <div class="gantt-track">
                      <div
                        class="gantt-bar {taskKindClass(t.task_kind)} {taskStatusClass(t.status)}"
                        style={taskBarStyle(t)}
                        title={`${t.planned_start || '?'} → ${t.planned_end || '?'}`}>
                        {#if t.actual_start || t.actual_end}
                          <div class="gantt-actual" style={`left:${pctForDate(t.actual_start) - pctForDate(t.planned_start) || 0}%`}></div>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <div class="card">
            <h2 class="card-title">Tasks</h2>
            <table class="task-table">
              <thead>
                <tr>
                  <th>#</th><th>Task</th><th>Kind</th>
                  <th>Planned</th><th>Actual</th>
                  <th>Resource</th><th>Assigned</th>
                  <th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {#each jobTasks as t (t.id)}
                  <tr>
                    <td class="muted small">{t.step_order}</td>
                    <td><strong>{t.name}</strong></td>
                    <td><span class="task-kind {taskKindClass(t.task_kind)}">{taskKindIcon(t.task_kind)} {t.task_kind.replace('_', ' ')}</span></td>
                    <td>
                      <input type="date" value={t.planned_start || ''} on:change={(e) => patchTask(t, { planned_start: e.currentTarget.value || null })} />
                      <input type="date" value={t.planned_end   || ''} on:change={(e) => patchTask(t, { planned_end:   e.currentTarget.value || null })} />
                    </td>
                    <td>
                      {#if t.actual_start || t.actual_end}
                        <div class="muted small">{t.actual_start || '?'} → {t.actual_end || '…'}</div>
                      {:else}<span class="muted small">—</span>{/if}
                    </td>
                    <td>
                      <select value={t.resource_id || ''} on:change={(e) => patchTask(t, { resource_id: e.currentTarget.value || null })}>
                        <option value="">—</option>
                        {#each schedulingResources as r}
                          <option value={r.id}>{r.name}</option>
                        {/each}
                      </select>
                    </td>
                    <td class="assignee-cell">
                      <!-- Lead + assistants as removable pills. Click the
                           ★ to promote an assist to lead. Lead can only
                           be replaced by picking a different person via
                           the + Add picker (or by clicking another's ★). -->
                      {#each (t.assignees || []) as a (a.employee_id)}
                        <span class="assignee-pill {a.role === 'lead' ? 'lead' : ''}" title={`${a.role === 'lead' ? 'Lead' : 'Assistant'}: ${a.name}`}>
                          {#if a.role === 'lead'}★{:else}<button class="pill-action" title="Promote to lead" on:click={() => promoteToLead(t, a.employee_id)}>★</button>{/if}
                          {a.name}
                          {#if a.role !== 'lead'}
                            <button class="pill-x" on:click={() => removeAssistant(t, a.employee_id)} title="Remove">×</button>
                          {/if}
                        </span>
                      {/each}
                      <!-- + Add picker. Filters out anyone already on the task. -->
                      <select
                        class="add-assist"
                        bind:value={assistPicks[t.id]}
                        on:change={(e) => addAssistant(t, e.currentTarget.value)}>
                        <option value="">+ Add</option>
                        {#each employees.filter((emp) => !(t.assignees || []).some((a) => a.employee_id === emp.id)) as emp}
                          <option value={emp.id}>{emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim()}</option>
                        {/each}
                      </select>
                    </td>
                    <td>
                      <span class="task-status {taskStatusClass(t.status)}">{t.status.replace('_', ' ')}</span>
                    </td>
                    <td class="row-actions">
                      {#if t.status === 'pending'}
                        <button class="btn btn-ghost" on:click={() => markTaskInProgress(t)}>Start</button>
                      {/if}
                      {#if t.status !== 'completed'}
                        <button class="btn btn-ghost" on:click={() => markTaskComplete(t)}>Done</button>
                      {/if}
                      <button class="btn btn-danger-ghost" on:click={() => deleteTask(t)}>×</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>

            <!-- Add-task drawer ----------------------------------------------- -->
            <details class="add-task">
              <summary>+ Add ad-hoc task</summary>
              <div class="add-task-grid">
                <label>Name<input bind:value={newTask.name} placeholder="Task name" /></label>
                <label>Kind
                  <select bind:value={newTask.task_kind}>
                    <option value="labor">Labor</option>
                    <option value="customer_wait">Customer wait</option>
                    <option value="vendor_wait">Vendor wait</option>
                    <option value="permit">Permit</option>
                    <option value="milestone">Milestone</option>
                  </select>
                </label>
                <label>Start<input type="date" bind:value={newTask.planned_start} /></label>
                <label>End<input type="date" bind:value={newTask.planned_end} /></label>
                <label>Hours<input type="number" min="0" step="0.5" bind:value={newTask.duration_hours} /></label>
                <label>Resource
                  <select bind:value={newTask.resource_id}>
                    <option value="">—</option>
                    {#each schedulingResources as r}
                      <option value={r.id}>{r.name}</option>
                    {/each}
                  </select>
                </label>
                <label>Assigned
                  <select bind:value={newTask.assigned_emp_id}>
                    <option value="">—</option>
                    {#each employees as emp}
                      <option value={emp.id}>{emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim()}</option>
                    {/each}
                  </select>
                </label>
                <label class="span-2">Notes<input bind:value={newTask.notes} /></label>
                <div class="span-all">
                  <button class="btn btn-primary" on:click={addTask}>Add task</button>
                </div>
              </div>
            </details>

            <!-- Apply additional template ------------------------------------- -->
            <details class="add-task">
              <summary>+ Apply another template</summary>
              <div class="apply-row" style="margin-top:8px">
                <select bind:value={applyTemplateId}>
                  <option value="">— pick template —</option>
                  {#each taskTemplates as t}
                    <option value={t.id}>{t.name} ({t.step_count} steps)</option>
                  {/each}
                </select>
                <select bind:value={applyAnchor}>
                  <option value="due_date">Anchor: due date</option>
                  <option value="install_date">Anchor: install date</option>
                  <option value="target">Anchor: specific date</option>
                </select>
                {#if applyAnchor === 'target'}<input type="date" bind:value={applyTargetDate} />{/if}
                <button class="btn btn-primary" on:click={applyTemplate} disabled={!applyTemplateId}>Apply</button>
              </div>
            </details>
          </div>
        {/if}

        <!-- Install panel inside the tab -->
        <div class="card">
          <h2 class="card-title">Install dates
            <a href="/schedule" target="_blank" class="muted small" style="float:right">Full calendar ↗</a>
          </h2>
          {#if installs.length === 0}
            <p class="muted">No installs scheduled. Use the
              <a href="/schedule" target="_blank">install calendar</a> to add one.
            </p>
          {:else}
            <table class="task-table">
              <thead><tr><th>Date</th><th>Crew</th><th>Time</th><th>Hours</th><th>Status</th><th>Notes</th></tr></thead>
              <tbody>
                {#each installs as i (i.id)}
                  <tr>
                    <td>{new Date(i.install_date).toLocaleDateString('en-CA')}</td>
                    <td>{i.crew_name || '—'}</td>
                    <td>{i.start_time ? i.start_time.slice(0,5) : '—'}</td>
                    <td>{i.duration_hours || '—'}</td>
                    <td><span class="task-status">{i.status}</span></td>
                    <td class="muted small">{i.notes || ''}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      </div>

    {:else if activeTab === 'proofs'}
      <div class="proofs-panel">
        <div class="card">
          <h2 class="card-title">Send a proof to the customer</h2>
          <p class="muted small">
            Upload the artwork JPEG (or PNG). The customer gets an emailed link
            with a preview — they can mark up the image and Approve or Request
            changes. Their response posts back to the Messages tab.
          </p>

          <div class="proof-upload-form">
            <label>
              Artwork file
              <input id="proof-file-input" type="file" accept="image/jpeg,image/png" on:change={onProofFileChange} />
            </label>

            <label>
              Customer email
              <input
                type="email"
                bind:value={proofRecipientEmail}
                placeholder={project?.contact_email || project?.client_email || 'name@example.com'}
              />
            </label>

            <label>
              Auto-bump status when approved <span class="muted">(optional)</span>
              <select bind:value={proofApproveStatusId}>
                <option value="">— don't change status —</option>
                {#each bumpStatusOptions as s}
                  <option value={s.id}>{s.status_name}</option>
                {/each}
              </select>
            </label>

            <label>
              Note to include in the email <span class="muted">(optional)</span>
              <textarea bind:value={proofNote} rows="3" placeholder="Anything you'd like to say to the customer with this proof"></textarea>
            </label>

            {#if proofUploadError}<div class="error inline">{proofUploadError}</div>{/if}

            <button class="btn btn-primary" on:click={submitProof} disabled={uploadingProof || !proofFile}>
              {uploadingProof ? 'Sending…' : 'Send proof'}
            </button>
          </div>
        </div>

        <!-- Preview card sits ABOVE the history table so clicking View
             doesn't require the user to scroll past 10+ rows. The
             preview itself also scrollIntoView's on click as belt+
             suspenders for long pages with the upload form expanded. -->
        {#if selectedProof}
          <div class="card" bind:this={proofPreviewEl}>
            <h2 class="card-title">
              v{selectedProof.version}
              <span class="pf-pill {proofStatusClass(selectedProof.status)}">{proofStatusLabel(selectedProof.status)}</span>
              <button class="btn btn-ghost" style="float:right" on:click={() => (selectedProofId = null)}>Close</button>
            </h2>

            {#if selectedProof.response_text}
              <blockquote class="customer-comment">
                <strong>{selectedProof.response_name || 'Customer'} said:</strong>
                <p>{selectedProof.response_text}</p>
              </blockquote>
            {/if}

            <ProofAnnotationCanvas
              imageUrl={selectedProof.image_url}
              initial={Array.isArray(selectedProof.annotations) ? selectedProof.annotations : []}
              readonly={true}
              authorLabel="staff"
            />
            <p class="muted small">
              Customer link:
              <a href={`${typeof window !== 'undefined' ? window.location.origin : ''}/proofs/${selectedProof.token}`} target="_blank" rel="noopener">
                /proofs/{selectedProof.token.slice(0, 8)}…
              </a>
            </p>
          </div>
        {/if}

        <div class="card">
          <h2 class="card-title">Proof history</h2>
          {#if proofsError}<div class="error inline">{proofsError}</div>{/if}

          {#if proofsLoading}
            <p class="muted">Loading…</p>
          {:else if proofs.length === 0}
            <p class="muted">No proofs sent yet.</p>
          {:else}
            <table class="proof-table">
              <thead>
                <tr><th>Version</th><th>Sent to</th><th>Sent</th><th>Status</th><th>Responded</th><th></th></tr>
              </thead>
              <tbody>
                {#each proofs as p (p.id)}
                  <tr class:selected={selectedProofId === p.id}>
                    <td>v{p.version}</td>
                    <td>{p.sent_to_email || '—'}</td>
                    <td>{p.uploaded_at ? new Date(p.uploaded_at).toLocaleString() : ''}</td>
                    <td><span class="pf-pill {proofStatusClass(p.status)}">{proofStatusLabel(p.status)}</span></td>
                    <td>
                      {#if p.responded_at}
                        <div>{new Date(p.responded_at).toLocaleString()}</div>
                        {#if p.response_name}<div class="muted small">{p.response_name}</div>{/if}
                      {:else}—{/if}
                    </td>
                    <td class="actions-cell">
                      <button class="btn btn-ghost" on:click={() => viewProof(p)}>View</button>
                      <button class="btn btn-ghost" on:click={() => copyProofLink(p)}>Copy link</button>
                      {#if $isStaff}
                        <button class="btn btn-danger-ghost" on:click={() => deleteProof(p)}>Delete</button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      </div>

    {:else if activeTab === 'messages'}
      <div class="messages-panel">
        <div class="card">
          <h2 class="card-title">Customer message thread</h2>
          <p class="empty-msg" style="margin:0 0 12px;color:#888;font-size:0.9em;">
            Customer-facing chat for job #{project.id}.
            Messages here are emailed to the customer ({project.contact_email || project.client_email || 'no email on file'}).
            Internal notes stay in the Notes tab.
          </p>
          {#if messages.length === 0}
            <p class="empty-msg">No messages yet. Start a conversation:</p>
          {:else}
            <ul class="msg-thread" style="list-style:none;padding:0;margin:0 0 16px;display:flex;flex-direction:column;gap:10px;max-height:420px;overflow-y:auto;">
              {#each messages as m (m.id)}
                <li class={`msg-row msg-${m.author_type}`} style="padding:10px 12px;border-radius:8px;max-width:88%;background:{m.author_type === 'staff' ? '#e8f0fe' : '#fef2f2'};border:1px solid {m.author_type === 'staff' ? '#c7d8f4' : '#f5c2c2'};align-self:{m.author_type === 'staff' ? 'flex-end' : 'flex-start'};">
                  <div style="display:flex;justify-content:space-between;gap:8px;font-size:0.82rem;color:#555;margin-bottom:4px;">
                    <strong>{m.author_name || (m.author_type === 'staff' ? 'Holm Graphics' : 'Customer')}</strong>
                    <span>{fmtMessageTime(m.created_at)}</span>
                  </div>
                  <div style="white-space:pre-wrap;word-wrap:break-word;">{m.body}</div>
                </li>
              {/each}
            </ul>
          {/if}
          {#if $isStaff}
            <form on:submit|preventDefault={sendStaffMessage}>
              <textarea rows="3" maxlength="4000" placeholder="Reply to the customer…" bind:value={newMessage} disabled={sendingMessage}></textarea>
              {#if messageErr}<div class="empty-msg" style="color:#c0392b;margin-top:4px;">{messageErr}</div>{/if}
              <button type="submit" class="btn btn-primary" style="margin-top:8px" disabled={sendingMessage || !newMessage.trim()}>
                {sendingMessage ? 'Sending…' : 'Send to customer'}
              </button>
            </form>
          {/if}
        </div>
      </div>

    {:else if activeTab === 'notes'}
      <div class="notes-panel">
        {#if $isStaff}
          <div class="card">
            <h2 class="card-title">Add Note</h2>
            <textarea rows="3" placeholder="Write a note about this job…" bind:value={newNote}></textarea>
            <button class="btn btn-primary" style="margin-top:8px" on:click={submitNote} disabled={addingNote || !newNote.trim()}>
              {addingNote ? 'Saving…' : 'Add Note'}
            </button>
          </div>
        {/if}
        {#each notes as note}
          <div class="note-item card">
            <div class="note-header">
              <span class="note-author">{note.employee_name || 'Staff'}</span>
              <span class="note-timestamp">{fmtDateTime(note.note_date)}</span>
            </div>
            <p class="note-body">{note.note_text}</p>
          </div>
        {/each}
        {#if notes.length === 0}<p class="empty-msg">No notes yet.</p>{/if}
      </div>

    {:else if activeTab === 'audit'}
      <div class="card">
        <h2 class="card-title">Status History</h2>
        <p class="empty-msg">Audit log coming soon.</p>
      </div>

    {/if}
  {/if}
</div>

{#if showMessageEmployeeModal}
  <div class="modal-backdrop" on:click={() => showMessageEmployeeModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h2>✉️ Email {project?.assigned_to || 'assignee'}</h2>
      <p class="muted small" style="margin:0 0 12px">
        Sends an email about job #{id} to the assigned employee.
        The job number, title, and a link are added automatically.
      </p>
      <label>
        Message
        <textarea rows="4" maxlength="600" bind:value={employeeMessage}
          placeholder="e.g. Customer moved pickup to Friday — bump this one up."
          disabled={sendingEmployeeMessage}></textarea>
      </label>
      <p class="muted small" style="margin:4px 0 0; text-align:right">{employeeMessage.length}/600</p>
      <div class="modal-actions" style="margin-top:12px">
        <span style="flex:1"></span>
        <button class="btn btn-ghost" on:click={() => showMessageEmployeeModal = false} disabled={sendingEmployeeMessage}>Cancel</button>
        <button class="btn btn-primary" on:click={sendEmployeeMessage} disabled={sendingEmployeeMessage || !employeeMessage.trim()}>
          {sendingEmployeeMessage ? '⏳ Sending…' : 'Send email'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if completingPhase}
  <div class="modal-backdrop" on:click={() => completingPhase = null}>
    <div class="modal" on:click|stopPropagation>
      <h2>Complete "{completingPhase.phase.name}"</h2>
      <p class="muted small" style="margin:0 0 12px">
        Marks this phase done as of now.
        {#if completingPhase.nextPhase}
          The next phase <strong>"{completingPhase.nextPhase.name}"</strong>
          ({partyLabel(completingPhase.nextPhase.responsible_party)}) will activate immediately.
        {:else}
          This is the last phase — the job's checklist will be complete.
        {/if}
      </p>
      {#if completingPhase.nextPhase}
        <label>
          Days budgeted for "{completingPhase.nextPhase.name}"
          <input type="number" min="0" step="0.5" bind:value={completingPhase.nextExpectedDays} />
        </label>
        <p class="muted small">Adjust based on current shop load — this drives the "overdue" warning on the next phase.</p>
      {/if}
      <div class="modal-actions" style="margin-top:12px">
        <span style="flex:1"></span>
        <button class="btn btn-ghost" on:click={() => completingPhase = null}>Cancel</button>
        <button class="btn btn-primary" on:click={confirmCompletePhase}>Complete & advance</button>
      </div>
    </div>
  </div>
{/if}

{#if editingPhase}
  <div class="modal-backdrop" on:click={() => editingPhase = null}>
    <div class="modal" on:click|stopPropagation>
      <h2>Edit phase</h2>
      <label>
        Name
        <input bind:value={editingPhase.name} />
      </label>
      <label>
        Status
        <select bind:value={editingPhase.status}>
          <option value="pending">Pending</option>
          <option value="active">Active (in progress)</option>
          <option value="completed">Completed</option>
          <option value="skipped">Skipped</option>
        </select>
      </label>
      <p class="muted small" style="margin:0">
        Reverting an active phase to pending stops its clock without
        touching adjacent phases — useful if you started it by mistake.
        Reverting "Completed" to "Pending" or "Active" does NOT un-start
        the next phase; edit that one separately if you need to roll the
        whole chain back.
      </p>
      <div class="row">
        <label style="flex:1">
          Responsibility
          <select bind:value={editingPhase.responsible_party}>
            <option value="shop">Shop</option>
            <option value="customer">Customer</option>
            <option value="vendor">Vendor</option>
            <option value="authority">Authority</option>
          </select>
        </label>
        <label style="flex:1">
          Days allowed
          <input type="number" min="0" step="0.5" bind:value={editingPhase.expected_days} />
        </label>
      </div>
      <label>
        Notes
        <textarea rows="2" bind:value={editingPhase.notes}></textarea>
      </label>
      <div class="modal-actions">
        <span style="flex:1"></span>
        <button class="btn btn-ghost" on:click={() => editingPhase = null}>Cancel</button>
        <button class="btn btn-primary" on:click={saveEditPhase}>Save</button>
      </div>
    </div>
  </div>
{/if}

{#if showLabelModal && project}
  <LabelPrintModal
    {project}
    bind:open={showLabelModal}
    on:close={() => showLabelModal = false}
  />
{/if}

{#if showFolderModal && project}
  <FolderPickerModal
    client={{
      id:               project.client_id,
      client_name:      project.client_name,
      files_folder:     project.client_folder_override || null,
      effective_folder: project.client_folder_name || project.client_name || ''
    }}
    bind:open={showFolderModal}
    on:close={() => showFolderModal = false}
    on:saved={onFolderMatchSaved}
  />
{/if}

<!-- "Send upload link" modal: mints a token, emails the recipient,
     and shows the URL for staff to copy. Inline rather than a separate
     component because it's small and tightly coupled to the staff
     job page (would be a 4-prop component for a 1-call-site flow). -->
{#if showUploadLinkModal && project}
  <div class="upload-link-backdrop" on:click|self={closeUploadLinkModal}>
    <div class="upload-link-modal" role="dialog" aria-modal="true" aria-labelledby="upload-link-title">
      <header class="ulm-header">
        <h3 id="upload-link-title">Send upload link</h3>
        <button class="ulm-close" on:click={closeUploadLinkModal} aria-label="Close">×</button>
      </header>

      {#if !uploadLinkResult}
        <p class="ulm-intro">
          Email the client a public link to drop artwork into <strong>job #{project.id}</strong>.
          They won't need to log in.
        </p>
        <div class="ulm-field">
          <label for="ulm-email">Recipient email</label>
          <input id="ulm-email" type="email" bind:value={uploadLinkRecipient}
                 placeholder="client@example.com" autofocus />
        </div>
        <div class="ulm-row">
          <div class="ulm-field">
            <label for="ulm-expiry">Expires in (days)</label>
            <input id="ulm-expiry" type="number" min="1" max="90" bind:value={uploadLinkExpiryDays} />
          </div>
          <div class="ulm-field">
            <label for="ulm-max">Max uploads</label>
            <input id="ulm-max" type="number" min="1" max="100" bind:value={uploadLinkMaxUploads} />
          </div>
        </div>
        <div class="ulm-field">
          <label for="ulm-note">Personal note <span class="ulm-optional">(optional, appears in the email body)</span></label>
          <textarea id="ulm-note" rows="3" bind:value={uploadLinkNote}
                    placeholder="Hi Rebecca — here's the link to drop the logo files. Vector preferred. Thanks!"></textarea>
        </div>
        {#if uploadLinkError}
          <p class="ulm-error">{uploadLinkError}</p>
        {/if}
        <div class="ulm-actions">
          <button class="btn btn-ghost" on:click={closeUploadLinkModal} disabled={uploadLinkSubmitting}>Cancel</button>
          <button class="btn btn-primary" on:click={submitUploadLink} disabled={uploadLinkSubmitting}>
            {uploadLinkSubmitting ? 'Sending…' : 'Send link'}
          </button>
        </div>
      {:else}
        <p class="ulm-intro">
          ✓ Link sent to <strong>{uploadLinkResult.recipient_email}</strong>.
          Expires {new Date(uploadLinkResult.expires_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}.
        </p>
        <div class="ulm-field">
          <label for="ulm-url">Link (also in the email)</label>
          <input id="ulm-url" type="text" readonly value={uploadLinkResult.url} on:focus={(e) => e.target.select()} />
        </div>
        <div class="ulm-actions">
          <button class="btn btn-ghost" on:click={copyUploadLink}>Copy link</button>
          <button class="btn btn-primary" on:click={closeUploadLinkModal}>Done</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .page { padding: 28px 32px; }

  .back-link {
    font-family: var(--font-display); font-size: 0.8rem;
    letter-spacing: 0.06em; color: var(--text-muted);
    text-transform: uppercase; display: inline-block; margin-bottom: 16px;
  }
  .back-link:hover { color: var(--red); }

  .job-headline {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 24px; flex-wrap: wrap; margin-bottom: 24px;
  }
  .job-id-tag {
    font-family: var(--font-display); font-size: 1.2rem; font-weight: 600;
    color: var(--text); letter-spacing: 0.01em; line-height: 1;
    display: block; margin-bottom: 6px;
  }
  .job-title {
    font-family: var(--font-display); font-size: 2.2rem; font-weight: 900;
    letter-spacing: 0.03em; color: var(--text); margin-bottom: 8px;
  }
  .headline-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .meta-sep { color: var(--text-dim); }
  .client-tag { font-size: 1rem; color: var(--text-muted); font-weight: 500; }
  .client-link { text-decoration: none; border-bottom: 1px dotted var(--text-dim); transition: color 0.15s; }
  .client-link:hover { color: var(--red); border-bottom-color: var(--red); }
  .assigned-tag { font-size: 0.9rem; color: var(--text-muted); }
  .type-tag { font-size: 0.9rem; color: var(--text-dim); font-style: italic; }

  .headline-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .status-change { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .status-change select { width: auto; }

  .tabs {
    display: flex; gap: 2px;
    border-bottom: 2px solid var(--border); margin-bottom: 24px;
  }
  .tab {
    background: none; border: none; border-bottom: 3px solid transparent;
    padding: 10px 20px; cursor: pointer;
    font-family: var(--font-display); font-size: 1rem; font-weight: 600;
    letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--text-muted); transition: all 0.15s; margin-bottom: -2px;
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--red); border-bottom-color: var(--red); }

  .overview-layout {
    display: grid; grid-template-columns: 380px 1fr;
    gap: 20px; align-items: start;
  }
  .col-left { display: flex; flex-direction: column; gap: 16px; }
  .col-right { display: flex; flex-direction: column; gap: 16px; }

  .card-title {
    font-family: var(--font-display); font-size: 0.85rem; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted);
    margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }
  .item-total { color: var(--text); font-size: 1rem; }
  .photo-count {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 20px; padding: 1px 10px;
    font-size: 0.82rem; color: var(--text-muted);
  }
  .edit-actions { display: flex; gap: 8px; }
  .edit-form { display: flex; flex-direction: column; }
  .item-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }

  .detail-table { width: 100%; border-collapse: collapse; }
  .detail-table td {
    padding: 10px 0; font-size: 1rem;
    border-bottom: 1px solid var(--border); vertical-align: top;
  }
  .detail-table td:first-child {
    color: var(--text-muted); width: 110px;
    font-family: var(--font-display); font-size: 0.82rem;
    letter-spacing: 0.06em; text-transform: uppercase; padding-right: 12px;
  }
  .detail-table tr:last-child td { border-bottom: none; }
  .overdue-cell { color: #dc2626; font-weight: 600; }
  .folder-link { font-size: 0.9rem; color: var(--blue); word-break: break-all; }
  .folder-link:hover { color: var(--red); }

  .btn-link {
    background: none; border: none; cursor: pointer;
    color: var(--red); font-size: 0.82rem;
    font-family: var(--font-display); font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; padding: 0;
  }

  .items-table { width: 100%; border-collapse: collapse; }
  .items-table th {
    text-align: left; padding: 8px 10px;
    font-family: var(--font-display); font-size: 0.75rem;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-muted); border-bottom: 2px solid var(--border);
    background: var(--surface-2);
  }
  .items-table td {
    padding: 10px 10px; border-bottom: 1px solid var(--border);
    color: var(--text); font-size: 0.95rem;
  }
  .items-table tr:last-child td { border-bottom: none; }
  .items-table tfoot td {
    padding: 10px 10px; border-top: 2px solid var(--border);
    font-weight: 700; background: var(--surface-2);
  }
  .tfoot-label { color: var(--text-muted); font-family: var(--font-display); font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .tfoot-total { color: var(--red); font-size: 1.1rem; font-family: var(--font-display); font-weight: 900; }
  .total-cell { font-weight: 600; }
  .text-muted { color: var(--text-muted) !important; }

  .item-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
  tr:hover .item-actions { opacity: 1; }
  .btn-icon {
    background: none; border: 1px solid var(--border); border-radius: var(--radius);
    cursor: pointer; padding: 2px 6px; font-size: 0.75rem; color: var(--text-muted);
  }
  .btn-icon:hover { border-color: var(--red); color: var(--red); }
  .btn-icon-danger:hover { background: #fee2e2; }

  .add-item-form {
    margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);
  }
  .add-item-title {
    font-family: var(--font-display); font-size: 0.8rem; font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-muted); margin-bottom: 12px;
  }
  .item-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .add-item-btn { width: 100%; justify-content: center; margin-top: 12px; }
  .item-add-row { display: flex; gap: 8px; }
  .item-add-row .add-item-btn { width: auto; flex: 1; text-decoration: none; }

  .qb-dropdown {
    position: absolute; top: 100%; left: 0; right: 0;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; max-height: 260px; overflow-y: auto;
    z-index: 100; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }
  .qb-dropdown-category {
    padding: 6px 12px 4px;
    font-family: var(--font-display); font-size: 0.7rem;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-dim); background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0;
  }
  .qb-dropdown-item {
    padding: 8px 12px; cursor: pointer;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.875rem;
  }
  .qb-dropdown-item:hover { background: var(--surface-2); }
  .qb-item-name { color: var(--text); }
  .qb-item-price { color: var(--text-muted); font-size: 0.8rem; }

  .photo-grid {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 8px; margin-bottom: 8px;
  }
  .photo-thumb {
    position: relative; aspect-ratio: 1;
    border-radius: var(--radius); overflow: hidden;
    border: 1px solid var(--border); cursor: pointer;
    background: var(--surface-2);
  }
  .photo-thumb img {
    width: 100%; height: 100%; object-fit: cover;
    transition: transform 0.2s;
  }
  .photo-thumb:hover img { transform: scale(1.04); }
  .photo-delete {
    position: absolute; top: 4px; right: 4px;
    background: rgba(0,0,0,0.6); border: none; cursor: pointer;
    color: #fff; border-radius: 50%; width: 22px; height: 22px;
    font-size: 0.7rem; display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.15s;
  }
  .photo-thumb:hover .photo-delete { opacity: 1; }

  .photo-gallery-controls {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: rgba(0,0,0,0.75); padding: 4px 6px;
    display: flex; flex-direction: column; gap: 3px;
  }
  .gallery-check {
    display: flex; align-items: center; gap: 4px;
    color: #fff; font-size: 0.72rem; cursor: pointer;
  }
  .gallery-check input { cursor: pointer; }
  .gallery-cat {
    font-size: 0.7rem; padding: 2px 4px;
    border-radius: 3px; border: none;
    background: rgba(255,255,255,0.9); color: #000;
    width: 100%;
  }

  .lightbox {
    position: fixed; inset: 0; background: rgba(0,0,0,0.92);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; cursor: pointer;
  }
  .lightbox img {
    max-width: 90vw; max-height: 90vh;
    object-fit: contain; border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  }
  .lightbox-close {
    position: absolute; top: 20px; right: 24px;
    background: none; border: none; color: #fff;
    font-size: 1.5rem; cursor: pointer; opacity: 0.7;
  }
  .lightbox-close:hover { opacity: 1; }

  .quoting-panel { display: flex; flex-direction: column; gap: 16px; }
  .card-title-row { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid var(--border); }
  .quote-actions { display: flex; gap: 8px; }

  .quote-table { width: 100%; border-collapse: collapse; }
  .quote-table th {
    text-align: left; padding: 8px 6px;
    font-family: var(--font-display); font-size: 0.72rem; font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted);
    border-bottom: 2px solid var(--border); background: var(--surface-2);
  }
  .quote-table th.qt-num { text-align: right; }
  .quote-table th.qt-x { width: 36px; }
  .quote-table td { padding: 4px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  .quote-table tbody tr:last-child td { border-bottom: none; }

  .quote-table input.cell {
    width: 100%; padding: 6px 8px;
    background: transparent; border: 1px solid transparent; border-radius: 4px;
    font: inherit; color: var(--text);
  }
  .quote-table input.cell:hover { border-color: var(--border); }
  .quote-table input.cell:focus { border-color: var(--red); background: var(--surface); outline: none; }
  .quote-table input.cell.num { text-align: right; font-variant-numeric: tabular-nums; }

  .cell-total { text-align: right; font-variant-numeric: tabular-nums; padding-right: 10px; color: var(--text); }
  .row-x {
    width: 28px; height: 28px; border: none; background: transparent; color: var(--text-dim);
    border-radius: 50%; cursor: pointer; font-size: 1.1rem; line-height: 1;
  }
  .row-x:hover { background: rgba(192,57,43,0.15); color: var(--red); }

  .quote-table tfoot td { padding-top: 12px; border-top: 2px solid var(--border); border-bottom: none; }
  .grand-label {
    text-align: right; font-family: var(--font-display);
    font-size: 0.85rem; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--text-muted);
  }
  .grand-total {
    text-align: right; font-family: var(--font-display);
    font-size: 1.1rem; font-weight: 700; color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .notes-panel { display: flex; flex-direction: column; gap: 16px; }
  .note-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .note-author { font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; color: var(--text); }
  .note-timestamp { font-size: 0.82rem; color: var(--text-dim); }
  .note-body { font-size: 0.95rem; color: var(--text-muted); line-height: 1.6; }
  .note-snippet { padding: 8px 0; border-bottom: 1px solid var(--border); }
  .note-snippet:last-of-type { border-bottom: none; }
  .note-date { font-size: 0.75rem; color: var(--text-dim); display: block; margin-bottom: 3px; }
  .note-snippet p { font-size: 0.9rem; color: var(--text-muted); }

  .empty-msg { color: var(--text-dim); font-style: italic; font-size: 0.95rem; padding: 16px 0; }
  .loading-state, .error-state {
    display: flex; align-items: center; gap: 12px;
    padding: 48px; color: var(--text-muted); font-size: 0.95rem;
  }
  .loading-spinner {
    width: 20px; height: 20px; border: 2px solid var(--border);
    border-top-color: var(--red); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* --- "Send upload link" modal -------------------------------------- */
  .ulm-optional { color: var(--text-dim, #9aa0a6); font-weight: normal; font-size: 0.85em; }
  .upload-link-modal textarea {
    width: 100%; box-sizing: border-box; resize: vertical;
    font: inherit; padding: 8px 10px; border-radius: 6px;
    border: 1px solid var(--border, #d0d4d8); background: var(--input-bg, #fff);
    color: var(--text, inherit);
  }
  .upload-link-backdrop {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .upload-link-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px 22px 22px;
    max-width: 480px;
    width: 100%;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .ulm-header { display: flex; justify-content: space-between; align-items: center; }
  .ulm-header h3 { margin: 0; font-size: 1.1rem; }
  .ulm-close {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 1.6rem; line-height: 1;
    padding: 0 0.25rem;
  }
  .ulm-close:hover { color: var(--red); }
  .ulm-intro { margin: 0; font-size: 0.92rem; color: var(--text); }
  .ulm-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ulm-field { display: flex; flex-direction: column; gap: 4px; }
  .ulm-field label {
    font-size: 0.78rem;
    color: var(--text-muted);
    font-family: var(--font-display);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .ulm-field input {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .ulm-field input:focus {
    outline: 2px solid var(--red);
    outline-offset: -1px;
  }
  .ulm-error {
    margin: 0;
    color: var(--red);
    background: rgba(220, 38, 38, 0.08);
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    font-size: 0.85rem;
  }
  .ulm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  @media (max-width: 900px) {
    .overview-layout { grid-template-columns: 1fr; }
    .page { padding: 16px; }
    .job-headline { flex-direction: column; }
    .item-row { grid-template-columns: 1fr; }
    .photo-grid { grid-template-columns: repeat(2, 1fr); }
  }

  /* --- Financial summary (for online-sourced jobs) --------------------- */
  .finsum {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 12px;
  }
  .finsum td {
    padding: 6px 0;
    font-size: 0.92rem;
  }
  .finsum td.k { color: var(--text-muted); }
  .finsum td.v {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-weight: 500;
  }
  .finsum tbody tr + tr td { border-top: 1px dashed transparent; }
  .finsum-total td {
    border-top: 1px solid var(--border);
    padding-top: 10px;
    font-weight: 700;
    font-size: 1rem;
  }
  .finsum-meta {
    margin: 12px 0 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .finsum-meta-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .finsum-meta dt {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    font-family: var(--font-display);
    margin: 0;
  }
  .finsum-meta dd {
    margin: 0;
    font-size: 0.88rem;
    color: var(--text);
    text-align: right;
  }
  .finsum-meta dd.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.82rem;
    color: var(--text-muted);
  }
  .finsum-meta a { color: inherit; }
  .finsum-meta a:hover { color: var(--red); }

  /* --- Decorations (per-position checkout config + artwork link) ------- */
  .decoration-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .decoration-row {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .decoration-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .decoration-position {
    font-weight: 600;
    color: var(--text);
  }
  .decoration-dims {
    font-size: 0.78rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .decoration-design {
    font-size: 0.88rem;
    color: var(--text-muted);
  }
  .decoration-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    margin-top: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
    font-size: 0.88rem;
    align-self: flex-start;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .decoration-link:hover {
    background: var(--surface-3, var(--surface-2));
    color: var(--red);
    border-color: var(--red);
  }
  .decoration-pending {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-dim);
    font-style: italic;
  }

  /* --- Files (L: drive via files-bridge) ------------------------------- */
  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
  }
  .file-row {
    display: flex;
    align-items: center;
    gap: 0;
    border-bottom: 1px solid var(--border);
  }
  .file-row:last-child { border-bottom: none; }
  .file-row.folder-row {
    padding: 9px 12px;
    color: var(--text-muted);
    font-size: 0.88rem;
    gap: 10px;
  }
  .file-link {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-size: 0.92rem;
    color: var(--text);
    text-decoration: none;
    transition: background 0.12s;
    min-width: 0;
  }
  .file-link:hover { background: var(--surface-2); color: var(--red); }
  /* When .file-link is used as the inner anchor of a folder-row, the
     wrapping <li> already supplies padding — reset so we don't double up. */
  .file-row.folder-row { padding: 0; }
  .file-row.folder-row .file-link {
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  .file-icon { font-size: 1.05rem; flex-shrink: 0; }
  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .file-meta {
    font-size: 0.76rem;
    color: var(--text-muted);
    flex-shrink: 0;
    margin-left: auto;
    padding-left: 10px;
  }
  .file-download {
    background: none;
    border: none;
    border-left: 1px solid var(--border);
    cursor: pointer;
    padding: 0 12px;
    font-size: 1rem;
    color: var(--text-muted);
    align-self: stretch;
    transition: background 0.12s, color 0.12s;
  }
  .file-download:hover { background: var(--surface-2); color: var(--red); }
  .folder-create { margin-top: 10px; }
  .folder-create-label {
    display: block; font-size: 0.76rem; color: var(--text-muted); margin-bottom: 6px;
  }
  .folder-create-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .folder-prefix { font-size: 0.85rem; color: var(--text-muted); white-space: nowrap; }
  .folder-desc-input { flex: 1; min-width: 160px; }
  .folder-create-hint { font-size: 0.76rem; color: var(--text-dim); margin-top: 6px; }
  .folder-create-warn {
    font-size: 0.78rem; color: #b45309; margin-top: 8px;
    background: rgba(180, 83, 9, 0.08); border: 1px solid rgba(180, 83, 9, 0.25);
    border-radius: var(--radius); padding: 8px 10px;
  }
  .folder-path {
    display: block;
    margin-top: 10px;
    padding: 8px 10px;
    background: var(--surface-2);
    border-radius: var(--radius);
    font-size: 0.76rem;
    color: var(--text-dim);
    text-decoration: none;
    word-break: break-all;
    transition: background 0.12s, color 0.12s;
  }
  .folder-path:hover {
    background: var(--surface-3, var(--surface-2));
    color: var(--red);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.88em;
  }

  /* --- Reference tabs (LED Signs, WiFi) -------------------------------- */
  .ref-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .ref-card {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    background: var(--surface);
  }
  .ref-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .ref-title {
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
  }
  .ref-sub {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .ref-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip {
    padding: 2px 9px;
    border-radius: 10px;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--surface-2);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .spec-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6px;
  }
  .spec-table td {
    padding: 5px 0;
    font-size: 0.9rem;
    border-bottom: 1px dotted var(--border);
    vertical-align: top;
  }
  .spec-table td:first-child {
    width: 140px;
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding-right: 10px;
  }
  .spec-table tr:last-child td { border-bottom: none; }

  .service-toggle {
    margin-top: 6px;
  }

  /* ── Inline add/edit forms used by the LED / WiFi / Modules tabs ── */
  .inline-form {
    background: var(--surface-2, #f7f7f9);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    margin: 0 0 16px;
  }
  .inline-form-nested {
    margin: 10px 0 6px;
    background: var(--surface-1, #fff);
  }
  .subhead {
    font-family: var(--font-display);
    font-size: 0.85rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 10px;
  }
  .subhead-sm {
    font-family: var(--font-display);
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
  }
  .form-grid label {
    display: flex;
    flex-direction: column;
    font-size: 0.78rem;
    color: var(--text-muted);
    gap: 4px;
  }
  .form-grid label.span-2 { grid-column: span 2; }
  .form-grid input,
  .form-grid select,
  .form-grid textarea {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.9rem;
    font-family: inherit;
    background: var(--surface-1, #fff);
    color: var(--text);
  }
  .form-grid input.mono { font-family: var(--font-mono, monospace); }
  .form-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    align-items: center;
  }
  .hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0 0 10px;
  }

  .btn-sm { padding: 3px 10px; font-size: 0.78rem; }
  .btn-danger {
    background: #dc2626;
    color: #fff;
    border: 1px solid #dc2626;
  }
  .btn-danger:hover { background: #b91c1c; }
  .btn-link-danger {
    background: none;
    border: none;
    color: #dc2626;
    cursor: pointer;
    padding: 0 4px;
    font-size: 0.82rem;
  }
  .btn-link-danger:hover { text-decoration: underline; }

  .service-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
  }

  .chip-on {
    background: var(--green-soft, #dcfce7);
    color: #166534;
    margin-left: 6px;
  }

  .sign-picker {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .sign-picker li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px dotted var(--border);
  }
  .sign-picker li:last-child { border-bottom: none; }

  /* ─── Proofs tab ─────────────────────────────────────────────────── */
  .proofs-panel { display: flex; flex-direction: column; gap: 12px; }
  .proof-upload-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-items: start;
  }
  .proof-upload-form > label { display: flex; flex-direction: column; gap: 4px; font-size: 0.9rem; }
  .proof-upload-form > label:nth-child(4),
  .proof-upload-form > .btn-primary,
  .proof-upload-form > .error.inline { grid-column: 1 / -1; }
  .proof-upload-form input,
  .proof-upload-form select,
  .proof-upload-form textarea {
    padding: 8px 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.95rem;
    box-sizing: border-box;
  }
  .proof-upload-form .btn-primary { justify-self: start; }
  .proof-table { width: 100%; border-collapse: collapse; }
  .proof-table th, .proof-table td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border, #e2e8f0);
    text-align: left;
    font-size: 0.92rem;
  }
  .proof-table tr.selected { background: #f1f5f9; }
  .proof-table .actions-cell { display: flex; gap: 6px; flex-wrap: wrap; }

  .pf-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .pf-pill.pf-sent      { background: #e0f2fe; color: #075985; }
  .pf-pill.pf-viewed    { background: #ede9fe; color: #5b21b6; }
  .pf-pill.pf-approved  { background: #dcfce7; color: #166534; }
  .pf-pill.pf-changes   { background: #fef3c7; color: #92400e; }
  .pf-pill.pf-stale     { background: #e2e8f0; color: #475569; }

  .customer-comment {
    background: #fffbeb;
    border-left: 4px solid #f59e0b;
    padding: 10px 14px;
    margin: 0 0 12px;
    border-radius: 4px;
  }
  .customer-comment p { margin: 4px 0 0; }
  .btn-danger-ghost {
    background: transparent;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }
  .btn-danger-ghost:hover { background: #fef2f2; }

  /* ─── Schedule tab ──────────────────────────────────────────────── */
  .schedule-tab { display: flex; flex-direction: column; gap: 12px; }
  .apply-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
  .apply-row select, .apply-row input { padding: 7px 9px; border: 1px solid var(--border, #cbd5e1); border-radius: 4px; }

  .gantt { margin: 8px 0 16px; }
  .gantt-axis {
    position: relative; height: 22px; margin-left: 200px;
    border-bottom: 1px solid #cbd5e1;
  }
  .gantt-tick {
    position: absolute; top: 0;
    font-size: 0.72rem; color: #64748b;
    transform: translateX(-50%);
    border-left: 1px dashed #e2e8f0;
    padding-left: 2px;
    height: 100%;
  }
  .gantt-due-line {
    position: absolute; top: -2px; bottom: -200px;
    width: 0; border-left: 2px dashed #c01818;
    transform: translateX(-1px);
    font-size: 0.7rem; color: #c01818; padding-left: 3px;
    z-index: 5;
  }
  .gantt-rows { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .gantt-row { display: flex; align-items: center; gap: 8px; }
  .gantt-label { width: 200px; font-size: 0.85rem; flex-shrink: 0; }
  .kind-icon { margin-right: 4px; }
  .gantt-track {
    position: relative; flex: 1; height: 22px;
    background: #f1f5f9; border-radius: 3px;
  }
  .gantt-bar {
    position: absolute; top: 2px; bottom: 2px;
    border-radius: 3px;
    background: #475569;
    box-shadow: 0 1px 2px rgba(0,0,0,.1);
  }
  .gantt-bar.tk-labor       { background: #1e40af; }
  .gantt-bar.tk-cwait       { background: #ca8a04; }
  .gantt-bar.tk-vwait       { background: #7c3aed; }
  .gantt-bar.tk-permit      { background: #0e7490; }
  .gantt-bar.tk-milestone   { background: #be123c; }
  .gantt-bar.ts-done        { background: #16a34a !important; }
  .gantt-bar.ts-prog        { background: #0ea5e9 !important; }
  .gantt-bar.ts-blk         { background: #b91c1c !important; }
  .gantt-bar.ts-skip        { background: #94a3b8 !important; opacity: 0.5; }
  .gantt-actual {
    position: absolute; top: -2px; height: 4px; width: 100%;
    background: #16a34a; border-radius: 2px;
  }

  .task-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .task-table th, .task-table td {
    padding: 6px 8px; border-bottom: 1px solid var(--border, #e2e8f0);
    text-align: left; vertical-align: middle;
  }
  .task-table input, .task-table select {
    padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 3px;
    font-size: 0.82rem; max-width: 100%;
  }
  .task-table .row-actions { display: flex; gap: 4px; }
  .task-kind, .task-status {
    display: inline-block; padding: 1px 6px;
    border-radius: 99px; font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.02em;
    font-weight: 600;
  }
  .task-kind.tk-labor       { background: #dbeafe; color: #1e40af; }
  .task-kind.tk-cwait       { background: #fef3c7; color: #ca8a04; }
  .task-kind.tk-vwait       { background: #ede9fe; color: #7c3aed; }
  .task-kind.tk-permit      { background: #cffafe; color: #0e7490; }
  .task-kind.tk-milestone   { background: #ffe4e6; color: #be123c; }
  .task-status.ts-pend  { background: #f1f5f9; color: #475569; }
  .task-status.ts-prog  { background: #e0f2fe; color: #075985; }
  .task-status.ts-done  { background: #dcfce7; color: #166534; }
  .task-status.ts-blk   { background: #fee2e2; color: #991b1b; }
  .task-status.ts-skip  { background: #e2e8f0; color: #64748b; }

  .add-task { margin-top: 12px; }
  .add-task summary { cursor: pointer; color: #475569; font-weight: 500; }
  .add-task-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-top: 8px;
  }
  .add-task-grid label { display: flex; flex-direction: column; gap: 3px; font-size: 0.8rem; color: #475569; }
  .add-task-grid input, .add-task-grid select {
    padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 3px; font-size: 0.85rem;
  }
  .add-task-grid .span-2 { grid-column: span 2; }
  .add-task-grid .span-all { grid-column: 1 / -1; }

  /* Phases checklist ----------------------------------------------- */
  .phase-ball {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 99px;
    color: #fff;
    font-size: 0.78rem;
    font-weight: 600;
    margin-left: 8px;
  }
  .phase-picker {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px;
    padding: 12px; background: #f8fafc; border-radius: 6px;
  }
  .phase-picker p { width: 100%; margin: 0 0 4px; }
  .phase-list { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .phase-item {
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #fff;
  }
  .phase-item.phase-completed { background: #f0fdf4; border-color: #bbf7d0; opacity: 0.85; }
  .phase-item.phase-active    { background: #eff6ff; border-color: #93c5fd; }
  .phase-item.phase-skipped   { background: #f8fafc; opacity: 0.6; }
  .phase-item.overdue         { border-color: #dc2626; background: #fef2f2; }
  .phase-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
  .phase-icon {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; color: #fff; font-size: 1.05rem;
    flex-shrink: 0;
  }
  .phase-body { flex: 1; min-width: 0; }
  .phase-head { display: flex; gap: 6px; align-items: baseline; }
  .phase-party { white-space: nowrap; }
  .phase-meta { margin-top: 2px; }
  .overdue-flag { color: #dc2626; font-weight: 600; }
  .phase-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .phase-progress {
    height: 4px; background: #e2e8f0;
    margin: 0 12px 8px;
    border-radius: 2px; overflow: hidden;
  }
  .phase-progress-fill { height: 100%; transition: width 0.3s ease; }

  /* Per-task multi-assignee pills */
  .assignee-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    min-width: 180px;
  }
  .assignee-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    background: #e0f2fe;
    color: #0c4a6e;
    border-radius: 99px;
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .assignee-pill.lead {
    background: #fde68a;
    color: #78350f;
    font-weight: 600;
  }
  .pill-x, .pill-action {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0 2px;
    font-size: 0.9em;
    line-height: 1;
  }
  .pill-x:hover { color: #b91c1c; }
  .add-assist {
    padding: 2px 6px !important;
    border: 1px dashed #94a3b8;
    border-radius: 99px;
    background: transparent;
    font-size: 0.75rem !important;
    color: #475569;
    cursor: pointer;
  }
</style>