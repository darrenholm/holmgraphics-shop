<!-- src/routes/jobs/[id]/+page.svelte -->
<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api, API_BASE } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';
  import { auth } from '$lib/stores/auth.js';

  let project = null;
  let notes = [];
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

  // Add measurement
  let addingMeasurement = false;
  let newMeasurement = { item: '', width: '', height: '', qty: '', notes: '' };
  let savingMeasurement = false;

  // Photos
  let uploadingPhotos = false;
  let photoInput;
  let lightboxPhoto = null;

  // Folder path
  let editingFolder = false;
  let folderPathInput = '';
  let savingFolder = false;

  // QuickBooks
  let sendingToQB = false;
  let qbInvoiceId = '';

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
  }

  // QB item filtering
  $: filteredQBItems = qbItemSearch
    ? qbItems.filter(i =>
        i.name.toLowerCase().includes(qbItemSearch.toLowerCase()) ||
        (i.category || '').toLowerCase().includes(qbItemSearch.toLowerCase())
      )
    : qbItems;

  // Group QB items by category for dropdown
  $: qbItemsByCategory = filteredQBItems.reduce((acc, item) => {
    const cat = item.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  function selectQBItem(item) {
    newItem.qb_item_name = item.name;
    if (item.price > 0) newItem.price = item.price;
    if (item.description) newItem.description = item.description;
    qbItemSearch = item.name;
    showQBDropdown = false;
    // Recalculate total
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
      project = await api.getProject(id);
      newStatusId = project.status_id || '';
    }
    catch (e) { alert(e.message); } finally { changingStatus = false; }
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
      newMeasurement = { item: '', width: '', height: '', qty: '', notes: '' };
      addingMeasurement = false;
    } catch (e) { alert(e.message); }
    finally { savingMeasurement = false; }
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

  async function deletePhoto(filename) {
    if (!confirm('Delete this photo?')) return;
    try {
      await api.deletePhoto(id, filename);
      photos = await api.getPhotos(id);
    } catch (e) { alert(e.message); }
  }

  async function updateGallery(photo, include, category) {
    try {
      await api.updatePhotoGallery(id, photo.filename, include, category);
      photos = photos.map(p => p.filename === photo.filename
        ? { ...p, gallery_include: include, gallery_category: category }
        : p
      );
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
          total_amount:   itemTotal,
          description:    project.project_name,
          project_number: project.id
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      qbInvoiceId = data.invoice_id;
      alert(`✅ Invoice #${data.doc_number} created in QuickBooks!`);
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

    const tableTop = 84;
    doc.setFillColor(30, 30, 30);
    doc.rect(margin, tableTop, pageW - margin * 2, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text('QTY', margin + 3, tableTop + 5.5);
    doc.text('DESCRIPTION', margin + 20, tableTop + 5.5);
    doc.text('PRICE', 148, tableTop + 5.5);
    doc.text('TOTAL', 172, tableTop + 5.5);

    let y = tableTop + 8;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...dark);
    items.forEach((item, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(margin, y, pageW - margin * 2, 8, 'F');
      }
      doc.setFontSize(9);
      doc.text(String(item.quantity ?? 1), margin + 3, y + 5.5);
      const desc = doc.splitTextToSize(item.item_name || '—', 110);
      doc.text(desc, margin + 20, y + 5.5);
      doc.text('$' + Number(item.unit_price || 0).toFixed(2), 148, y + 5.5);
      doc.text('$' + Number(item.total || 0).toFixed(2), 172, y + 5.5);
      y += Math.max(8, desc.length * 5);
    });

    y += 6;
    const subtotal = items.reduce((s, i) => s + Number(i.total || 0), 0);
    const hst = subtotal * 0.13;
    const total = subtotal + hst;

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(140, y, pageW - margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
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

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Thank you for considering Holm Graphics', pageW / 2, 280, { align: 'center' });

    doc.setFillColor(...red);
    doc.rect(0, 284, pageW, 6, 'F');

    doc.save(`Quote-${project.id}-${project.client_name || 'Client'}.pdf`);
    const subject = encodeURIComponent(`Quote #${project.id} - ${project.project_name || ''}`);
    const body = encodeURIComponent(`Hi ${project.contact || project.client_name || ''},\n\nPlease find attached your quote for ${project.project_name || ''}.\n\nSubtotal: $${subtotal.toFixed(2)}\nHST: $${hst.toFixed(2)}\nTotal: $${total.toFixed(2)}\n\nPlease don't hesitate to contact us if you have any questions.\n\nThank you for considering Holm Graphics!\n\nDarren Holm\nHolm Graphics Inc.\n519-507-3001\ninfo@holmgraphics.ca`);
    const email = project.client_email || project.contact_email || '';
    window.open(`mailto:${email}?subject=${subject}&body=${body}`);
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
          <span class="client-tag">{project.client_name || '—'}</span>
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
        {/if}
      </div>
    </div>

    <nav class="tabs">
      {#each ['overview','notes','audit'] as t}
        <button class="tab" class:active={activeTab === t} on:click={() => activeTab = t}>
          {t === 'overview' ? 'Overview' : t === 'notes' ? `Notes (${notes.length})` : 'Audit Log'}
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
                <div class="form-group">
                  <label>Contact Name</label>
                  <input bind:value={editForm.contact} />
                </div>
                <div class="form-group">
                  <label>Contact Phone</label>
                  <input bind:value={editForm.contact_phone} />
                </div>
                <div class="form-group">
                  <label>Contact Email</label>
                  <input bind:value={editForm.contact_email} />
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
                  <tr><td>Type</td><td>{project.project_type || '—'}</td></tr>
                  <tr><td>Status</td><td><span class="badge {statusCls(project.status_name)}">{project.status_name || '—'}</span></td></tr>
                  <tr><td>Assigned</td><td>{project.assigned_to || '—'}</td></tr>
                  <tr><td>Created</td><td>{fmtDate(project.date_created)}</td></tr>
                  <tr><td>Due Date</td><td class:overdue-cell={isOverdue(project)}>{fmtDate(project.due_date)}</td></tr>
                  {#if project.contact}<tr><td>Contact</td><td>{project.contact}</td></tr>{/if}
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
                <thead><tr><th>Item</th><th>W (in)</th><th>H (in)</th><th>Notes</th></tr></thead>
                <tbody>
                  {#each project.measurements as m}
                    <tr>
                      <td>{m.item || '—'}</td>
                      <td>{m.width || '—'}</td>
                      <td>{m.height || '—'}</td>
                      <td class="text-muted">{m.notes || '—'}</td>
                    </tr>
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
                      <input type="number" bind:value={newMeasurement.width} placeholder="48" />
                    </div>
                    <div class="form-group">
                      <label>Height (in)</label>
                      <input type="number" bind:value={newMeasurement.height} placeholder="24" />
                    </div>
                    <div class="form-group">
                      <label>Qty</label>
                      <input type="number" bind:value={newMeasurement.qty} placeholder="1" />
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
                    <th>QB Item</th><th>Description</th><th>Qty</th><th>Price</th><th>Total</th>
                    {#if $isStaff}<th></th>{/if}
                  </tr>
                </thead>
                <tbody>
                  {#each items as item}
                    {#if editingItem?.id === item.id}
  <tr>
    <td style="position:relative">
      <input
        bind:value={editItemForm.qb_item_name}
        placeholder="QB item…"
        on:focus={() => showQBDropdown = true}
        on:blur={() => setTimeout(() => showQBDropdown = false, 200)}
      />
      {#if showQBDropdown && Object.keys(qbItemsByCategory).length > 0}
        <div class="qb-dropdown">
          {#each Object.entries(qbItemsByCategory) as [cat, catItems]}
            <div class="qb-dropdown-category">{cat}</div>
            {#each catItems as qbItem}
              <div class="qb-dropdown-item" on:mousedown={() => { editItemForm.qb_item_name = qbItem.name; if (qbItem.price > 0) editItemForm.price = qbItem.price; showQBDropdown = false; }}>
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
                        <td class="text-muted" style="font-size:0.82rem">{item.qb_item_name || '—'}</td>
                        <td>{item.item_name || '—'}</td>
                        <td>{item.quantity ?? '—'}</td>
                        <td>{currency(item.unit_price)}</td>
                        <td class="total-cell">{currency(item.total)}</td>
                        {#if $isStaff}
                          <td>
                            <div class="item-actions">
                              <button class="btn-icon" title="Edit" on:click={() => startItemEdit(item)}>✏</button>
                              <button class="btn-icon btn-icon-danger" title="Delete" on:click={() => deleteItem(item.id)}>✕</button>
                            </div>
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

                  <!-- QB Item Picker -->
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

                  <!-- Description -->
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
                <button class="btn btn-ghost add-item-btn" on:click={() => addingItem = true}>+ Add Item</button>
              {/if}
            {/if}
          </div>

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
                      <button class="photo-delete" on:click={() => deletePhoto(photo.filename)}>✕</button>
                      <div class="photo-gallery-controls">
                        <label class="gallery-check">
                          <input
                            type="checkbox"
                            checked={photo.gallery_include}
                            on:change={(e) => updateGallery(photo, e.target.checked, photo.gallery_category)}
                          />
                          Gallery
                        </label>
                        {#if photo.gallery_include}
                          <select
                            class="gallery-cat"
                            value={photo.gallery_category || ''}
                            on:change={(e) => updateGallery(photo, true, e.target.value)}
                          >
                            <option value="">Category…</option>
                            <option value="Signs & LED">Signs & LED</option>
                            <option value="Vehicle Wraps">Vehicle Wraps</option>
                            <option value="Apparel">Apparel</option>
                            <option value="Printing">Printing</option>
                          </select>
                        {/if}
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
                {uploadingPhotos ? 'Uploading…' : '+ Upload Photos'}
              </button>
            {/if}
          </div>
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
    font-family: var(--font-display); font-size: 0.75rem; color: var(--text-dim);
    letter-spacing: 0.1em; text-transform: uppercase; display: block; margin-bottom: 4px;
  }
  .job-title {
    font-family: var(--font-display); font-size: 2.2rem; font-weight: 900;
    letter-spacing: 0.03em; color: var(--text); margin-bottom: 8px;
  }
  .headline-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .meta-sep { color: var(--text-dim); }
  .client-tag { font-size: 1rem; color: var(--text-muted); font-weight: 500; }
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

  /* QB Item Dropdown */
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

  @media (max-width: 900px) {
    .overview-layout { grid-template-columns: 1fr; }
    .page { padding: 16px; }
    .job-headline { flex-direction: column; }
    .item-row { grid-template-columns: 1fr; }
    .photo-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
