<!-- src/routes/admin/staff/+page.svelte
     Staff contact info: each employee's email (where the job page's
     "Email <assignee>" messages go), mobile number (where job-assignment
     texts are sent), and their SkySwitch PBX extension. Admin-gated.

     The cell number feeds the SMS notifier (lib/employee-notifier.js) — an
     employee with no number is simply skipped, no text sent. Same deal
     for email: no address, no message. -->
<script>
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isAdmin } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import 'cropperjs/dist/cropper.css';

  let employees = [];
  let loading = true;
  let saving  = new Set(); // employee ids currently saving
  let error = '';
  let message = '';

  // Per-row editable drafts, keyed by employee id.
  let drafts = {}; // { [id]: { phone_number, phone_extension } }

  onMount(async () => {
    if (!$auth || !$isAdmin) { goto('/login?return=/admin/staff'); return; }
    await load();
  });

  async function load() {
    loading = true; error = ''; message = '';
    try {
      employees = await api.employeesList();
      drafts = Object.fromEntries(employees.map(e => [e.id, {
        email: e.email || '',
        phone_number: e.phone_number || '',
        phone_extension: e.phone_extension || '',
      }]));
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function fullName(p) {
    return [p.first_name, p.last_name].filter(Boolean).join(' ') || `Employee #${p.id}`;
  }

  function isDirty(e) {
    const d = drafts[e.id] || {};
    return (d.email || '') !== (e.email || '')
        || (d.phone_number || '') !== (e.phone_number || '')
        || (d.phone_extension || '') !== (e.phone_extension || '');
  }

  async function saveOne(id) {
    error = ''; message = '';
    const next = new Set(saving); next.add(id); saving = next;
    try {
      const updated = await api.employeeSetContact(id, drafts[id]);
      employees = employees.map(e => e.id === id
        ? { ...e, email: updated.email, phone_number: updated.phone_number, phone_extension: updated.phone_extension }
        : e);
      drafts = { ...drafts, [id]: {
        email: updated.email || '',
        phone_number: updated.phone_number || '',
        phone_extension: updated.phone_extension || '',
      } };
      message = `Saved ${fullName(updated)}.`;
    } catch (e) {
      error = e.message || String(e);
    } finally {
      const n = new Set(saving); n.delete(id); saving = n;
    }
  }

  $: withPhone = employees.filter(e => e.phone_number).length;
  $: withEmail = employees.filter(e => e.email).length;
  // Reference `drafts` so Svelte re-runs this when any input changes —
  // isDirty reads drafts internally, which Svelte 4 can't see. The Set is
  // what the per-row buttons key off; calling isDirty(emp) directly in the
  // template never re-evaluates (drafts isn't a dependency there), which
  // left the Save buttons permanently disabled.
  $: dirtySet = (drafts, new Set(employees.filter(isDirty).map(e => e.id)));
  $: dirtyCount = dirtySet.size;

  // ── Add employee ──────────────────────────────────────────────────────
  let showAdd = false;
  let adding = false;
  let newEmp = { first_name: '', last_name: '', email: '', phone_number: '', phone_extension: '' };
  async function addEmployee() {
    if (!newEmp.first_name.trim() && !newEmp.last_name.trim()) return;
    adding = true; error = ''; message = '';
    try {
      const created = await api.employeeCreate(newEmp);
      message = `Added ${fullName(created)}. They can be assigned jobs right away; set a password before they need dashboard access.`;
      newEmp = { first_name: '', last_name: '', email: '', phone_number: '', phone_extension: '' };
      showAdd = false;
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      adding = false;
    }
  }

  // ── Driver's license (photo → crop → save to record) ──────────────────
  let licenseInput;            // hidden <input type=file>
  let licenseEmp = null;       // employee being edited
  let cropSrc = '';            // object URL of the chosen photo
  let cropImgEl;               // <img> the cropper attaches to
  let cropper = null;
  let savingLicense = false;

  function pickLicense(emp) {
    licenseEmp = emp;
    licenseInput.value = '';
    licenseInput.click();
  }

  async function onLicenseChosen(e) {
    const file = e.target.files?.[0];
    if (!file || !licenseEmp) return;
    cropSrc = URL.createObjectURL(file);
    await tick(); // let the modal + <img> render
    const { default: Cropper } = await import('cropperjs');
    cropper?.destroy();
    cropper = new Cropper(cropImgEl, {
      viewMode: 1,
      autoCropArea: 0.9,
      background: false,
    });
  }

  function closeCrop() {
    cropper?.destroy(); cropper = null;
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    cropSrc = ''; licenseEmp = null;
  }

  async function saveLicense() {
    if (!cropper || !licenseEmp) return;
    savingLicense = true; error = ''; message = '';
    try {
      const canvas = cropper.getCroppedCanvas({ maxWidth: 1600, maxHeight: 1600 });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Could not crop the image.');
      const r = await api.employeeLicenseUpload(licenseEmp.id, blob, `license-${licenseEmp.id}.jpg`);
      employees = employees.map((e) => e.id === licenseEmp.id
        ? { ...e, license_uploaded_at: r.license_uploaded_at } : e);
      message = `License saved for ${fullName(licenseEmp)}.`;
      closeCrop();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      savingLicense = false;
    }
  }

  async function viewLicense(emp) {
    try {
      const url = await api.employeeLicenseBlobUrl(emp.id);
      const win = window.open(url, '_blank', 'noopener');
      if (!win) window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { error = e.message || String(e); }
  }

  async function deleteLicense(emp) {
    if (!confirm(`Remove ${fullName(emp)}'s license image?`)) return;
    try {
      await api.employeeLicenseDelete(emp.id);
      employees = employees.map((e) => e.id === emp.id ? { ...e, license_uploaded_at: null } : e);
      message = `License removed for ${fullName(emp)}.`;
    } catch (e) { error = e.message || String(e); }
  }

  let savingAll = false;
  async function saveAll() {
    savingAll = true; error = ''; message = '';
    let ok = 0, failed = 0;
    for (const emp of employees.filter(isDirty)) {
      try {
        const updated = await api.employeeSetContact(emp.id, drafts[emp.id]);
        employees = employees.map(e => e.id === emp.id
          ? { ...e, email: updated.email, phone_number: updated.phone_number, phone_extension: updated.phone_extension }
          : e);
        drafts = { ...drafts, [emp.id]: {
          email: updated.email || '',
          phone_number: updated.phone_number || '',
          phone_extension: updated.phone_extension || '',
        } };
        ok++;
      } catch (e) {
        failed++;
        error = `${fullName(emp)}: ${e.message || e}`;
      }
    }
    if (ok) message = `Saved ${ok} employee${ok === 1 ? '' : 's'}.`;
    savingAll = false;
  }
</script>

<svelte:head><title>Staff Contact — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <h1 class="page-title">Staff Contact</h1>

  <div class="card intro">
    <p>
      Set each employee's <strong>email</strong>, <strong>mobile number</strong>, and <strong>extension</strong>.
      Email is where the job page's "Email <em>assignee</em>" messages go; the mobile
      number is where a text is sent when a job is assigned. Anyone without an
      address/number is simply skipped.
    </p>
    <p class="muted">
      Emailable: <strong>{withEmail}</strong> / {employees.length} ·
      Textable: <strong>{withPhone}</strong> / {employees.length}
    </p>
  </div>

  {#if message}<div class="notice ok">{message}</div>{/if}
  {#if error}<div class="notice error">{error}</div>{/if}

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if employees.length === 0}
    <div class="muted">No active employees.</div>
  {:else}
    <div class="table-actions">
      <button class="btn" on:click={() => showAdd = !showAdd}>
        {showAdd ? 'Cancel' : '＋ Add employee'}
      </button>
      <button class="btn primary"
              disabled={dirtyCount === 0 || savingAll}
              on:click={saveAll}>
        {savingAll ? 'Saving…' : dirtyCount ? `Save all changes (${dirtyCount})` : 'Save all changes'}
      </button>
    </div>

    {#if showAdd}
      <div class="card add-form">
        <div class="add-grid">
          <label>First name <input bind:value={newEmp.first_name} disabled={adding} /></label>
          <label>Last name <input bind:value={newEmp.last_name} disabled={adding} /></label>
          <label>Email <input type="email" placeholder="name@holmgraphics.ca" bind:value={newEmp.email} disabled={adding} /></label>
          <label>Mobile <input type="tel" placeholder="519-555-0123" bind:value={newEmp.phone_number} disabled={adding} /></label>
          <label>Ext <input class="ext" placeholder="104" bind:value={newEmp.phone_extension} disabled={adding} /></label>
        </div>
        <p class="muted" style="margin:10px 0 0">
          New staff can be assigned jobs (and get notifications) immediately.
          They can't log into the dashboard until a password is set for them.
        </p>
        <div class="table-actions" style="margin:10px 0 0">
          <button class="btn primary"
                  disabled={adding || (!newEmp.first_name.trim() && !newEmp.last_name.trim())}
                  on:click={addEmployee}>
            {adding ? 'Adding…' : 'Add employee'}
          </button>
        </div>
      </div>
    {/if}
    <table class="map-table">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Email</th>
          <th>Mobile number</th>
          <th>Extension</th>
          <th>Texts</th>
          <th>License</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each employees as emp (emp.id)}
          <tr>
            <td>
              <div class="emp-name">{fullName(emp)}</div>
            </td>
            <td>
              <input
                type="email"
                inputmode="email"
                placeholder="name@holmgraphics.ca"
                bind:value={drafts[emp.id].email}
                disabled={saving.has(emp.id)} />
            </td>
            <td>
              <input
                type="tel"
                inputmode="tel"
                placeholder="519-555-0123"
                bind:value={drafts[emp.id].phone_number}
                disabled={saving.has(emp.id)} />
            </td>
            <td>
              <input
                class="ext"
                type="text"
                inputmode="numeric"
                placeholder="104"
                bind:value={drafts[emp.id].phone_extension}
                disabled={saving.has(emp.id)} />
            </td>
            <td>
              {#if emp.phone_number}
                <span class="status on">on</span>
              {:else}
                <span class="status off">no number</span>
              {/if}
            </td>
            <td class="license-cell">
              {#if emp.license_uploaded_at}
                <button class="btn small" on:click={() => viewLicense(emp)} title="View license">🪪 View</button>
                <button class="btn small" on:click={() => pickLicense(emp)} title="Replace license">↻</button>
                <button class="btn small danger" on:click={() => deleteLicense(emp)} title="Remove license">×</button>
              {:else}
                <button class="btn small" on:click={() => pickLicense(emp)}>＋ Add</button>
              {/if}
            </td>
            <td class="row-actions">
              <button class="btn small primary"
                      disabled={!dirtySet.has(emp.id) || saving.has(emp.id) || savingAll}
                      on:click={() => saveOne(emp.id)}>
                {saving.has(emp.id) ? '…' : 'Save'}
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<input type="file" accept="image/*" bind:this={licenseInput}
       on:change={onLicenseChosen} style="display:none" />

{#if cropSrc}
  <div class="crop-backdrop" on:click={closeCrop}>
    <div class="crop-modal" on:click|stopPropagation>
      <h2>Crop {licenseEmp ? fullName(licenseEmp) : ''}'s license</h2>
      <p class="muted" style="margin:0 0 10px">
        Drag to frame just the license — trims the table/background out of the photo.
      </p>
      <div class="crop-stage">
        <!-- svelte-ignore a11y-missing-attribute -->
        <img bind:this={cropImgEl} src={cropSrc} />
      </div>
      <div class="crop-actions">
        <button class="btn" on:click={() => cropper && cropper.rotate(90)} disabled={savingLicense}>⟳ Rotate</button>
        <span style="flex:1"></span>
        <button class="btn" on:click={closeCrop} disabled={savingLicense}>Cancel</button>
        <button class="btn primary" on:click={saveLicense} disabled={savingLicense}>
          {savingLicense ? 'Saving…' : 'Save license'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 24px; max-width: 1000px; margin: 0 auto; }
  .page-title {
    font-family: var(--font-display); font-size: 1.6rem;
    letter-spacing: 0.04em; text-transform: uppercase;
    margin: 0 0 18px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    margin-bottom: 14px;
  }
  .card p { margin: 0 0 8px; }
  .card p:last-child { margin-bottom: 0; }
  .muted { color: var(--text-muted); font-size: 0.92rem; }

  .notice { padding: 10px 12px; border-radius: var(--radius); margin: 8px 0; font-size: 0.92rem; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red,   #dc3545); border: 1px solid rgba(220,53,69,0.3); }

  .map-table { width: 100%; border-collapse: collapse; }
  .map-table th, .map-table td {
    padding: 10px 12px; text-align: left; vertical-align: middle;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .map-table th {
    color: var(--text-muted); font-weight: 600;
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .emp-name { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 0.82rem; margin-top: 2px; }

  .map-table input {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 10px;
    font: inherit;
    min-width: 160px;
  }
  .map-table input.ext { min-width: 80px; width: 90px; }

  .status {
    padding: 2px 8px; border-radius: 999px; font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
  }
  .status.on  { background: rgba(40,167,69,0.18); color: var(--green, #28a745); }
  .status.off { background: rgba(255,255,255,0.08); color: var(--text-muted); }

  .table-actions { display: flex; justify-content: flex-end; gap: 8px; margin: 0 0 10px; }
  .add-form { margin-bottom: 14px; }
  .add-grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .add-grid label {
    display: flex; flex-direction: column; gap: 4px;
    font-size: 0.8rem; color: var(--text-muted);
  }
  .add-grid input {
    background: var(--input-bg, var(--surface)); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 6px 10px; font: inherit; min-width: 160px;
  }
  .add-grid input.ext { min-width: 70px; width: 80px; }
  .row-actions { white-space: nowrap; }
  .btn {
    padding: 6px 12px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary  { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn.small    { padding: 3px 9px; font-size: 0.85rem; }
  .btn.danger   { color: var(--red, #dc3545); }

  .license-cell { white-space: nowrap; }
  .license-cell .btn + .btn { margin-left: 4px; }

  .crop-backdrop {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.65);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .crop-modal {
    background: var(--surface, #1c1c1e);
    border: 1px solid var(--border, #333);
    border-radius: var(--radius-lg, 10px);
    padding: 18px;
    width: min(720px, 100%);
  }
  .crop-modal h2 { margin: 0 0 6px; font-size: 1.1rem; }
  .crop-stage {
    max-height: 60vh;
    overflow: hidden;
    background: #000;
    border-radius: var(--radius, 6px);
  }
  .crop-stage img { display: block; max-width: 100%; }
  .crop-actions { display: flex; gap: 8px; margin-top: 12px; }
</style>
