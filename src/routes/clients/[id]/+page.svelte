<!-- src/routes/clients/[id]/+page.svelte -->
<!--
  Client detail page. All client-scoped edits live here:
    - basic info (company, names, email)
    - addresses  (normalized table, many per client)
    - phones     (normalized table, many per client)
    - NAS folder override (via FolderPickerModal)
    - jobs list  (server-side filter on ?clientId=)
    - LED Signs, WiFi, Modules — moved here from the job detail page.
      They were always client-scoped; the job page was just a convenient
      tab host until we had a real clients section.
-->
<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';
  import FolderPickerModal from '$lib/components/FolderPickerModal.svelte';

  // ─── Core state ───────────────────────────────────────────────────
  let client = null;
  let loading = true;
  let error = '';
  let activeTab = 'overview';

  // Client basics edit
  let editingBasics = false;
  let savingBasics = false;
  let editBasics = {};

  // Addresses
  let addingAddress = false;
  let newAddress = { address1: '', address2: '', town: '', province: '', postal_code: '', address_type: '' };
  let savingAddress = false;
  let editingAddressId = null;
  let editAddress = {};

  // Phones
  let addingPhone = false;
  let newPhone = { number: '', ext: '', phone_type: '' };
  let savingPhone = false;
  let editingPhoneId = null;
  let editPhone = {};

  // Jobs tab
  let jobs = [];
  let jobsLoading = false;
  let jobsLoaded = false;
  let jobsError = '';

  // LED Signs tab — copied from job detail page wiring.
  let ledSigns = [];
  let ledLoading = false;
  let ledError = '';
  let ledLoaded = false;
  let addingSign = false;
  let newSign = { sign_name: '', location: '' };
  let savingSign = false;
  let editingSignId = null;
  let editSign = {};
  let savingEditSign = false;
  let loggingServiceForSignId = null;
  let newService = { service_date: '', issue: '', solution: '', serviced_by: '' };
  let savingService = false;
  let expandedSignId = null;
  let employees = [];

  // WiFi tab
  let wifiEntries = [];
  let wifiLoading = false;
  let wifiError = '';
  let wifiLoaded = false;
  let addingWifi = false;
  let newWifi = { location: '', ssid: '', password: '' };
  let savingWifi = false;
  let editingWifiId = null;
  let editWifi = { location: '', ssid: '', password: '' };

  // Modules tab
  let modules = [];
  let modulesLoading = false;
  let modulesError = '';
  let modulesLoaded = false;
  let addingModule = false;
  let newModule = { module_id_no: '', starting_inventory: '', on_hand: '' };
  let savingModule = false;
  let editingModuleId = null;
  let editModule = { module_id_no: '', starting_inventory: '', on_hand: '' };
  let pickingSignForModuleId = null;

  // Folder-match modal
  let showFolderModal = false;

  // Billing terms (Net 15/30/60/90) — gated behind a confirm modal when
  // enabling allow_invoice_checkout, since that flips the customer's online
  // checkout to skip card collection entirely. The DB-level CHECK constraint
  // (clients_invoice_checkout_requires_terms) also enforces that a non-null
  // payment_terms_days exists when the box is checked; the UI mirrors that.
  let editingTerms = false;
  let savingTerms = false;
  let editTerms = { payment_terms_days: '', allow_invoice_checkout: false };
  let showTermsConfirm = false;
  const TERMS_OPTIONS = [
    { value: '',   label: 'Pay at checkout (default)' },
    { value: 15,   label: 'Net 15 days' },
    { value: 30,   label: 'Net 30 days' },
    { value: 60,   label: 'Net 60 days' },
    { value: 90,   label: 'Net 90 days' },
  ];

  function startEditTerms() {
    editingTerms = true;
    editTerms = {
      payment_terms_days:     client.payment_terms_days ?? '',
      allow_invoice_checkout: !!client.allow_invoice_checkout,
    };
  }
  function cancelEditTerms() {
    editingTerms = false;
    showTermsConfirm = false;
  }

  function attemptSaveTerms() {
    // Mirror the DB CHECK so the user gets immediate feedback rather than
    // a 400 round-trip.
    if (editTerms.allow_invoice_checkout && editTerms.payment_terms_days === '') {
      alert('Pick a Net X term before approving invoice checkout.');
      return;
    }
    // Confirmation modal only fires for the privileged transition
    // (turning ON invoice checkout, or changing terms while it's already on).
    // Toggling terms while invoice-checkout is OFF is harmless and saves
    // straight through.
    const enablingNow = editTerms.allow_invoice_checkout && !client.allow_invoice_checkout;
    const changingTermsWhileOn = editTerms.allow_invoice_checkout
      && client.allow_invoice_checkout
      && Number(editTerms.payment_terms_days) !== Number(client.payment_terms_days);
    if (enablingNow || changingTermsWhileOn) {
      showTermsConfirm = true;
      return;
    }
    saveTerms();
  }

  async function saveTerms() {
    showTermsConfirm = false;
    savingTerms = true;
    try {
      const patch = {
        payment_terms_days: editTerms.payment_terms_days === '' ? null : Number(editTerms.payment_terms_days),
        allow_invoice_checkout: !!editTerms.allow_invoice_checkout,
      };
      const updated = await api.updateClient(id, patch);
      client = { ...client, ...updated };
      editingTerms = false;
    } catch (e) { alert(e.message); }
    finally { savingTerms = false; }
  }

  function describeTerms(c) {
    if (!c) return '';
    if (c.allow_invoice_checkout && c.payment_terms_days) {
      return `Net ${c.payment_terms_days} — invoice checkout approved`;
    }
    if (c.payment_terms_days) {
      return `Net ${c.payment_terms_days} (recorded; not yet approved for online invoice checkout)`;
    }
    return 'Pay at checkout';
  }

  $: id = parseInt($page.params.id, 10);
  onMount(loadAll);

  async function loadAll() {
    loading = true; error = '';
    try {
      client = await api.getClient(id);
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function displayName(c) {
    if (!c) return '';
    return c.company_name
      || [c.first_name, c.last_name].filter(Boolean).join(' ')
      || '(unnamed)';
  }

  // ─── Basics edit ──────────────────────────────────────────────────
  function startEditBasics() {
    editingBasics = true;
    editBasics = {
      company:    client.company_name || '',
      first_name: client.first_name   || '',
      last_name:  client.last_name    || '',
      email:      client.email        || ''
    };
  }
  function cancelEditBasics() { editingBasics = false; }

  async function saveBasics() {
    if (!editBasics.company.trim() && !editBasics.last_name.trim()) {
      alert('Company or last name is required.');
      return;
    }
    savingBasics = true;
    try {
      const updated = await api.updateClient(id, editBasics);
      client = { ...client, ...updated };
      editingBasics = false;
    } catch (e) { alert(e.message); }
    finally { savingBasics = false; }
  }

  // ─── Address handlers ─────────────────────────────────────────────
  async function submitNewAddress() {
    if (!newAddress.address1.trim() && !newAddress.town.trim()) {
      alert('Enter at least a street or city.');
      return;
    }
    savingAddress = true;
    try {
      const created = await api.createClientAddress(id, newAddress);
      client = { ...client, addresses: [...(client.addresses || []), created] };
      newAddress = { address1: '', address2: '', town: '', province: '', postal_code: '', address_type: '' };
      addingAddress = false;
    } catch (e) { alert(e.message); }
    finally { savingAddress = false; }
  }
  function startEditAddress(a) {
    editingAddressId = a.id;
    editAddress = {
      address1:     a.address1 || '',
      address2:     a.address2 || '',
      town:         a.city     || '',
      province:     a.province || '',
      postal_code:  a.postal   || '',
      address_type: a.type     || ''
    };
  }
  function cancelEditAddress() { editingAddressId = null; }
  async function saveEditAddress() {
    savingAddress = true;
    try {
      const updated = await api.updateClientAddress(editingAddressId, editAddress);
      client = {
        ...client,
        addresses: client.addresses.map(a => a.id === updated.id ? updated : a)
      };
      editingAddressId = null;
    } catch (e) { alert(e.message); }
    finally { savingAddress = false; }
  }
  async function deleteAddress(a) {
    if (!confirm(`Delete ${a.address1 || a.city || 'this address'}?`)) return;
    try {
      await api.deleteClientAddress(a.id);
      client = { ...client, addresses: client.addresses.filter(x => x.id !== a.id) };
    } catch (e) { alert(e.message); }
  }

  // ─── Phone handlers ───────────────────────────────────────────────
  async function submitNewPhone() {
    if (!newPhone.number.trim()) { alert('Phone number is required.'); return; }
    savingPhone = true;
    try {
      const created = await api.createClientPhone(id, newPhone);
      client = { ...client, phones: [...(client.phones || []), created] };
      newPhone = { number: '', ext: '', phone_type: '' };
      addingPhone = false;
    } catch (e) { alert(e.message); }
    finally { savingPhone = false; }
  }
  function startEditPhone(p) {
    editingPhoneId = p.id;
    editPhone = {
      number:     p.phone_number || '',
      ext:        p.ext          || '',
      phone_type: p.type         || ''
    };
  }
  function cancelEditPhone() { editingPhoneId = null; }
  async function saveEditPhone() {
    savingPhone = true;
    try {
      const updated = await api.updateClientPhone(editingPhoneId, editPhone);
      client = {
        ...client,
        phones: client.phones.map(p => p.id === updated.id ? updated : p)
      };
      editingPhoneId = null;
    } catch (e) { alert(e.message); }
    finally { savingPhone = false; }
  }
  async function deletePhone(p) {
    if (!confirm(`Delete phone ${p.phone_number}?`)) return;
    try {
      await api.deleteClientPhone(p.id);
      client = { ...client, phones: client.phones.filter(x => x.id !== p.id) };
    } catch (e) { alert(e.message); }
  }

  // ─── Folder override ──────────────────────────────────────────────
  // Reuse the FolderPickerModal. It expects { id, client_name, files_folder,
  // effective_folder }. We reload after save.
  async function onFolderMatchSaved() {
    try { client = await api.getClient(id); }
    catch (e) { alert(e.message); }
  }

  // ─── Tab-scoped loaders ───────────────────────────────────────────
  async function loadJobs({ force = false } = {}) {
    if (jobsLoaded && !force) return;
    jobsLoading = true; jobsError = '';
    try {
      jobs = await api.getProjects({ clientId: id });
      jobsLoaded = true;
    } catch (e) { jobsError = e.message || String(e); }
    finally { jobsLoading = false; }
  }

  async function loadLedSigns({ force = false } = {}) {
    if (ledLoaded && !force) return;
    ledLoading = true; ledError = '';
    try {
      ledSigns = await api.getClientLedSigns(id);
      if (!employees.length) {
        try { employees = await api.getEmployees(); } catch {}
      }
      ledLoaded = true;
    } catch (e) { ledError = e.message || String(e); }
    finally { ledLoading = false; }
  }

  async function loadWifi({ force = false } = {}) {
    if (wifiLoaded && !force) return;
    wifiLoading = true; wifiError = '';
    try {
      wifiEntries = await api.getClientWifi(id);
      wifiLoaded = true;
    } catch (e) { wifiError = e.message || String(e); }
    finally { wifiLoading = false; }
  }

  async function loadModules({ force = false } = {}) {
    if (modulesLoaded && !force) return;
    modulesLoading = true; modulesError = '';
    try {
      modules = await api.getClientModules(id);
      modulesLoaded = true;
    } catch (e) { modulesError = e.message || String(e); }
    finally { modulesLoading = false; }
  }

  function onTabChange(t) {
    activeTab = t;
    if (t === 'jobs'      && !jobsLoaded)    loadJobs();
    if (t === 'led-signs' && !ledLoaded)     loadLedSigns();
    if (t === 'wifi'      && !wifiLoaded)    loadWifi();
    if (t === 'modules'   && !modulesLoaded) loadModules();
  }

  // ─── LED Sign handlers (lifted from job detail) ───────────────────
  function toggleSignDetail(signId) {
    expandedSignId = expandedSignId === signId ? null : signId;
  }

  async function submitNewSign() {
    if (!newSign.sign_name.trim()) { alert('Sign name is required.'); return; }
    savingSign = true;
    try {
      const created = await api.createLedSign(id, newSign);
      ledSigns = [...ledSigns, { ...created, service_history: [] }];
      newSign = { sign_name: '', location: '' };
      addingSign = false;
    } catch (e) { alert(e.message); }
    finally { savingSign = false; }
  }

  function startEditSign(s) {
    editingSignId = s.id;
    editSign = {
      sign_name:       s.sign_name || '',
      location:        s.location || '',
      control_system:  s.control_system || '',
      pitch:           s.pitch || '',
      width_mm:        s.width_mm ?? '',
      height_mm:       s.height_mm ?? '',
      serial_number:   s.serial_number || '',
      inventory_no:    s.inventory_no || '',
      module_size:     s.module_size || '',
      power_supply:    s.power_supply || '',
      esa_no:          s.esa_no || '',
      faces:           s.faces ?? '',
      cabinets:        s.cabinets ?? '',
      install_date:    s.install_date ? String(s.install_date).split('T')[0] : '',
      voltage:         s.voltage || '',
      total_amp:       s.total_amp || '',
      wifi_ssid:       s.wifi_ssid || '',
      cloud_username:  s.cloud_username || '',
      cellular_number: s.cellular_number || ''
    };
  }
  function cancelEditSign() { editingSignId = null; }

  async function saveEditSign() {
    savingEditSign = true;
    try {
      const payload = { ...editSign };
      for (const k of ['width_mm','height_mm','faces','cabinets']) {
        payload[k] = payload[k] === '' ? null : Number(payload[k]);
      }
      const updated = await api.updateLedSign(editingSignId, payload);
      ledSigns = ledSigns.map(s => s.id === updated.id ? { ...s, ...updated } : s);
      editingSignId = null;
    } catch (e) { alert(e.message); }
    finally { savingEditSign = false; }
  }

  async function deleteSign(s) {
    if (!confirm(`Delete sign "${s.sign_name || s.id}" and its service history?`)) return;
    try {
      await api.deleteLedSign(s.id);
      ledSigns = ledSigns.filter(x => x.id !== s.id);
    } catch (e) { alert(e.message); }
  }

  function startLogService(signId) {
    loggingServiceForSignId = signId;
    newService = { service_date: '', issue: '', solution: '', serviced_by: '' };
    if (expandedSignId !== signId) expandedSignId = signId;
  }
  function cancelLogService() { loggingServiceForSignId = null; }

  async function submitService() {
    if (!newService.issue.trim() && !newService.solution.trim()) {
      alert('Enter at least an issue or a solution.');
      return;
    }
    savingService = true;
    try {
      await api.logLedService(loggingServiceForSignId, newService);
      await loadLedSigns({ force: true });
      loggingServiceForSignId = null;
    } catch (e) { alert(e.message); }
    finally { savingService = false; }
  }

  async function deleteService(serviceId) {
    if (!confirm('Delete this service record?')) return;
    try {
      await api.deleteLedService(serviceId);
      await loadLedSigns({ force: true });
    } catch (e) { alert(e.message); }
  }

  function fmtPitch(p) { return p === null || p === undefined || p === '' ? '—' : `P${p}`; }
  function fmtSignSize(s) {
    if (s.width_mm && s.height_mm) {
      const wIn = (s.width_mm / 25.4).toFixed(1);
      const hIn = (s.height_mm / 25.4).toFixed(1);
      return `${wIn}" × ${hIn}"  (${s.width_mm} × ${s.height_mm} mm)`;
    }
    return '—';
  }

  // ─── WiFi handlers ────────────────────────────────────────────────
  async function submitNewWifi() {
    if (!newWifi.location && !newWifi.ssid) { alert('Enter at least a location or SSID.'); return; }
    savingWifi = true;
    try {
      const created = await api.createWifi(id, newWifi);
      wifiEntries = [...wifiEntries, created];
      newWifi = { location: '', ssid: '', password: '' };
      addingWifi = false;
    } catch (e) { alert(e.message); }
    finally { savingWifi = false; }
  }
  function startEditWifi(w) {
    editingWifiId = w.id;
    editWifi = { location: w.location || '', ssid: w.ssid || '', password: w.password || '' };
  }
  function cancelEditWifi() { editingWifiId = null; }
  async function saveEditWifi() {
    savingWifi = true;
    try {
      const updated = await api.updateWifi(editingWifiId, editWifi);
      wifiEntries = wifiEntries.map(w => w.id === updated.id ? updated : w);
      editingWifiId = null;
    } catch (e) { alert(e.message); }
    finally { savingWifi = false; }
  }
  async function deleteWifiEntry(w) {
    if (!confirm(`Delete WiFi entry for "${w.location || w.ssid || w.id}"?`)) return;
    try {
      await api.deleteWifi(w.id);
      wifiEntries = wifiEntries.filter(x => x.id !== w.id);
    } catch (e) { alert(e.message); }
  }

  // ─── Module handlers ──────────────────────────────────────────────
  async function submitNewModule() {
    if (!newModule.module_id_no.trim()) { alert('Module ID # is required.'); return; }
    savingModule = true;
    try {
      await api.createModule({
        module_id_no:       newModule.module_id_no,
        starting_inventory: newModule.starting_inventory === '' ? null : Number(newModule.starting_inventory),
        on_hand:            newModule.on_hand === '' ? null : Number(newModule.on_hand)
      });
      newModule = { module_id_no: '', starting_inventory: '', on_hand: '' };
      addingModule = false;
      await loadModules({ force: true });
    } catch (e) { alert(e.message); }
    finally { savingModule = false; }
  }
  function startEditModule(m) {
    editingModuleId = m.id;
    editModule = {
      module_id_no:       m.module_id_no || '',
      starting_inventory: m.starting_inventory ?? '',
      on_hand:            m.on_hand ?? ''
    };
  }
  function cancelEditModule() { editingModuleId = null; }
  async function saveEditModule() {
    savingModule = true;
    try {
      const updated = await api.updateModule(editingModuleId, {
        module_id_no:       editModule.module_id_no,
        starting_inventory: editModule.starting_inventory === '' ? null : Number(editModule.starting_inventory),
        on_hand:            editModule.on_hand === '' ? null : Number(editModule.on_hand)
      });
      modules = modules.map(m => m.id === updated.id ? { ...m, ...updated } : m);
      editingModuleId = null;
    } catch (e) { alert(e.message); }
    finally { savingModule = false; }
  }
  async function deleteModuleRow(m) {
    if (!confirm(`Delete module "${m.module_id_no}"?`)) return;
    try {
      await api.deleteModule(m.id);
      modules = modules.filter(x => x.id !== m.id);
    } catch (e) { alert(e.message); }
  }
  async function linkSignToModule(moduleId, signId) {
    try {
      await api.setSignModule(signId, moduleId);
      pickingSignForModuleId = null;
      await Promise.all([
        loadModules({ force: true }),
        loadLedSigns({ force: true })
      ]);
    } catch (e) { alert(e.message); }
  }
  async function unlinkSignFromModule(signId) {
    if (!confirm('Unlink this sign from its module?')) return;
    try {
      await api.setSignModule(signId, null);
      await Promise.all([
        loadModules({ force: true }),
        loadLedSigns({ force: true })
      ]);
    } catch (e) { alert(e.message); }
  }

  // ─── Utility formatters ───────────────────────────────────────────
  function fmtDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date)) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtAddressLine(a) {
    const parts = [];
    if (a.address1) parts.push(a.address1);
    if (a.address2) parts.push(a.address2);
    const line2 = [a.city, a.province, a.postal].filter(Boolean).join(', ');
    if (line2) parts.push(line2);
    return parts.length ? parts.join(' · ') : '—';
  }
  function fmtPhoneLine(p) {
    const main = p.phone_number || '—';
    return p.ext ? `${main} ext. ${p.ext}` : main;
  }
</script>

<svelte:head>
  <title>{client ? displayName(client) : 'Client'} · Holm Graphics</title>
</svelte:head>

<div class="page">
  <a href="/clients" class="back-link">← All clients</a>

  {#if loading}
    <p class="empty-msg">Loading client…</p>
  {:else if error}
    <p class="empty-msg" style="color:#dc2626">⚠ {error}</p>
  {:else if !client}
    <p class="empty-msg">Client not found.</p>
  {:else}
    <div class="job-headline">
      <div>
        <span class="job-id-tag">Client #{client.id}</span>
        <div class="job-title">
          {displayName(client)}
          {#if client.allow_invoice_checkout && client.payment_terms_days}
            <span class="terms-badge" title="Approved for invoice checkout — orders place without paying upfront">Net {client.payment_terms_days}</span>
          {/if}
        </div>
      </div>
    </div>

    <nav class="tabs">
      <button class:active={activeTab === 'overview'}  on:click={() => onTabChange('overview')}>Overview</button>
      <button class:active={activeTab === 'jobs'}      on:click={() => onTabChange('jobs')}>Jobs</button>
      <button class:active={activeTab === 'led-signs'} on:click={() => onTabChange('led-signs')}>LED Signs</button>
      <button class:active={activeTab === 'wifi'}      on:click={() => onTabChange('wifi')}>WiFi</button>
      <button class:active={activeTab === 'modules'}   on:click={() => onTabChange('modules')}>Modules</button>
    </nav>

    {#if activeTab === 'overview'}
      <!-- Basics -->
      <div class="card">
        <h2 class="card-title">
          Client info
          <div class="edit-actions">
            {#if $isStaff && !editingBasics}
              <button class="btn btn-ghost btn-sm" on:click={startEditBasics}>Edit</button>
            {/if}
          </div>
        </h2>
        {#if editingBasics}
          <div class="form-grid">
            <label>Company<input bind:value={editBasics.company} /></label>
            <label>Email<input type="email" bind:value={editBasics.email} /></label>
            <label>First name<input bind:value={editBasics.first_name} /></label>
            <label>Last name<input bind:value={editBasics.last_name} /></label>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" on:click={saveBasics} disabled={savingBasics}>
              {savingBasics ? 'Saving…' : 'Save'}
            </button>
            <button class="btn btn-ghost" on:click={cancelEditBasics}>Cancel</button>
          </div>
        {:else}
          <table class="spec-table">
            <tbody>
              <tr><td>Company</td><td>{client.company_name || '—'}</td></tr>
              <tr><td>First name</td><td>{client.first_name || '—'}</td></tr>
              <tr><td>Last name</td><td>{client.last_name || '—'}</td></tr>
              <tr><td>Email</td><td class="mono">{client.email || '—'}</td></tr>
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Billing terms -->
      <div class="card">
        <h2 class="card-title">
          Billing terms
          <div class="edit-actions">
            {#if $isStaff && !editingTerms}
              <button class="btn btn-ghost btn-sm" on:click={startEditTerms}>Edit</button>
            {/if}
          </div>
        </h2>
        {#if editingTerms}
          <div class="form-grid">
            <label>Payment terms
              <select bind:value={editTerms.payment_terms_days}>
                {#each TERMS_OPTIONS as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </label>
            <label class="span-2 checkbox">
              <input type="checkbox" bind:checked={editTerms.allow_invoice_checkout} />
              <span>Approve for online invoice checkout (skip card collection at /shop/checkout)</span>
            </label>
          </div>
          <p class="hint">
            With invoice checkout approved, this client's online orders place
            with <strong>payment_method=invoice_pending</strong> and a QBO Invoice
            (not Sales Receipt) is generated with a due date of {editTerms.payment_terms_days || 'N'} days.
          </p>
          <div class="form-actions">
            <button class="btn btn-primary" on:click={attemptSaveTerms} disabled={savingTerms}>
              {savingTerms ? 'Saving…' : 'Save'}
            </button>
            <button class="btn btn-ghost" on:click={cancelEditTerms}>Cancel</button>
          </div>
        {:else}
          <table class="spec-table">
            <tbody>
              <tr><td>Status</td><td>{describeTerms(client)}</td></tr>
              <tr><td>Terms</td><td>{client.payment_terms_days ? `Net ${client.payment_terms_days}` : '—'}</td></tr>
              <tr><td>Invoice checkout</td><td>{client.allow_invoice_checkout ? 'Yes' : 'No'}</td></tr>
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Addresses -->
      <div class="card">
        <h2 class="card-title">
          Addresses
          <span class="photo-count">{(client.addresses || []).length}</span>
          <div class="edit-actions">
            {#if $isStaff && !addingAddress}
              <button class="btn btn-primary btn-sm" on:click={() => addingAddress = true}>+ Add</button>
            {/if}
          </div>
        </h2>

        {#if addingAddress}
          <div class="inline-form">
            <div class="form-grid">
              <label>Type<input bind:value={newAddress.address_type} placeholder="Billing / Shipping / Site" /></label>
              <label>Street<input bind:value={newAddress.address1} placeholder="123 Main St" /></label>
              <label>Unit / Suite<input bind:value={newAddress.address2} /></label>
              <label>City<input bind:value={newAddress.town} /></label>
              <label>Province<input bind:value={newAddress.province} /></label>
              <label>Postal code<input bind:value={newAddress.postal_code} /></label>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" on:click={submitNewAddress} disabled={savingAddress}>
                {savingAddress ? 'Saving…' : 'Save'}
              </button>
              <button class="btn btn-ghost" on:click={() => { addingAddress = false; newAddress = { address1:'', address2:'', town:'', province:'', postal_code:'', address_type:'' }; }}>Cancel</button>
            </div>
          </div>
        {/if}

        {#if !client.addresses || client.addresses.length === 0}
          {#if !addingAddress}<p class="empty-msg">No addresses on file.</p>{/if}
        {:else}
          <table class="items-table">
            <thead>
              <tr>
                <th style="width:110px">Type</th>
                <th>Address</th>
                {#if $isStaff}<th style="width:140px"></th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each client.addresses as a}
                {#if editingAddressId === a.id}
                  <tr>
                    <td colspan={$isStaff ? 3 : 2}>
                      <div class="form-grid">
                        <label>Type<input bind:value={editAddress.address_type} /></label>
                        <label>Street<input bind:value={editAddress.address1} /></label>
                        <label>Unit / Suite<input bind:value={editAddress.address2} /></label>
                        <label>City<input bind:value={editAddress.town} /></label>
                        <label>Province<input bind:value={editAddress.province} /></label>
                        <label>Postal code<input bind:value={editAddress.postal_code} /></label>
                      </div>
                      <div class="form-actions">
                        <button class="btn btn-primary btn-sm" on:click={saveEditAddress} disabled={savingAddress}>
                          {savingAddress ? 'Saving…' : 'Save'}
                        </button>
                        <button class="btn btn-ghost btn-sm" on:click={cancelEditAddress}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                {:else}
                  <tr>
                    <td>{a.type || '—'}</td>
                    <td>{fmtAddressLine(a)}</td>
                    {#if $isStaff}
                      <td>
                        <button class="btn-link" on:click={() => startEditAddress(a)}>Edit</button>
                        <button class="btn-link-danger" on:click={() => deleteAddress(a)}>Delete</button>
                      </td>
                    {/if}
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Phones -->
      <div class="card">
        <h2 class="card-title">
          Phones
          <span class="photo-count">{(client.phones || []).length}</span>
          <div class="edit-actions">
            {#if $isStaff && !addingPhone}
              <button class="btn btn-primary btn-sm" on:click={() => addingPhone = true}>+ Add</button>
            {/if}
          </div>
        </h2>

        {#if addingPhone}
          <div class="inline-form">
            <div class="form-grid">
              <label>Type<input bind:value={newPhone.phone_type} placeholder="Main / Cell / Fax" /></label>
              <label>Number<input bind:value={newPhone.number} placeholder="519-555-1234" /></label>
              <label>Extension<input bind:value={newPhone.ext} /></label>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" on:click={submitNewPhone} disabled={savingPhone}>
                {savingPhone ? 'Saving…' : 'Save'}
              </button>
              <button class="btn btn-ghost" on:click={() => { addingPhone = false; newPhone = { number:'', ext:'', phone_type:'' }; }}>Cancel</button>
            </div>
          </div>
        {/if}

        {#if !client.phones || client.phones.length === 0}
          {#if !addingPhone}<p class="empty-msg">No phone numbers on file.</p>{/if}
        {:else}
          <table class="items-table">
            <thead>
              <tr>
                <th style="width:110px">Type</th>
                <th>Number</th>
                {#if $isStaff}<th style="width:140px"></th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each client.phones as p}
                {#if editingPhoneId === p.id}
                  <tr>
                    <td><input bind:value={editPhone.phone_type} /></td>
                    <td>
                      <input bind:value={editPhone.number} style="width:60%" />
                      <input bind:value={editPhone.ext} placeholder="ext" style="width:25%; margin-left:4px" />
                    </td>
                    {#if $isStaff}
                      <td>
                        <button class="btn-link" on:click={saveEditPhone} disabled={savingPhone}>{savingPhone ? '…' : 'Save'}</button>
                        <button class="btn-link" on:click={cancelEditPhone}>Cancel</button>
                      </td>
                    {/if}
                  </tr>
                {:else}
                  <tr>
                    <td>{p.type || '—'}</td>
                    <td class="mono">{fmtPhoneLine(p)}</td>
                    {#if $isStaff}
                      <td>
                        <button class="btn-link" on:click={() => startEditPhone(p)}>Edit</button>
                        <button class="btn-link-danger" on:click={() => deletePhone(p)}>Delete</button>
                      </td>
                    {/if}
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Folder override -->
      {#if $isStaff}
        <div class="card">
          <h2 class="card-title">NAS folder</h2>
          <p class="hint">
            Used by the files-bridge to find this client's L:\ folder when its name
            doesn't match our derived company/last-name pattern.
          </p>
          <div class="folder-row">
            <div>
              <div class="folder-value mono">
                {client.files_folder || client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || '—'}
              </div>
              {#if client.files_folder}
                <div class="hint">Manual override</div>
              {:else}
                <div class="hint">Auto-derived from name</div>
              {/if}
            </div>
            <button class="btn btn-ghost btn-sm" on:click={() => showFolderModal = true}>
              Change folder
            </button>
          </div>
        </div>
      {/if}

    {:else if activeTab === 'jobs'}
      <div class="card">
        <h2 class="card-title">
          Jobs
          {#if jobsLoaded}<span class="photo-count">{jobs.length}</span>{/if}
          <div class="edit-actions">
            <button class="btn btn-ghost" on:click={() => loadJobs({ force: true })} disabled={jobsLoading} title="Refresh">
              {jobsLoading ? '…' : '⟳'}
            </button>
          </div>
        </h2>
        {#if jobsLoading && !jobsLoaded}
          <p class="empty-msg">Loading…</p>
        {:else if jobsError}
          <p class="empty-msg" style="color:#dc2626">⚠ {jobsError}</p>
        {:else if jobs.length === 0}
          <p class="empty-msg">No jobs for this client yet.</p>
        {:else}
          <table class="items-table">
            <thead>
              <tr>
                <th style="width:80px">Job #</th>
                <th>Description</th>
                <th style="width:130px">Status</th>
                <th style="width:120px">Due</th>
              </tr>
            </thead>
            <tbody>
              {#each jobs as j}
                <tr on:click={() => goto(`/jobs/${j.id}`)} style="cursor:pointer">
                  <td class="mono">#{j.id}</td>
                  <td>{j.project_name || '—'}</td>
                  <td>{j.status_name || '—'}</td>
                  <td>{fmtDate(j.due_date)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

    {:else if activeTab === 'led-signs'}
      <div class="card">
        <h2 class="card-title">
          LED Signs
          {#if ledLoaded}<span class="photo-count">{ledSigns.length}</span>{/if}
          <div class="edit-actions">
            {#if $isStaff && !addingSign}
              <button class="btn btn-primary btn-sm" on:click={() => addingSign = true}>+ Add Sign</button>
            {/if}
            <button class="btn btn-ghost" on:click={() => loadLedSigns({ force: true })} disabled={ledLoading} title="Refresh">
              {ledLoading ? '…' : '⟳'}
            </button>
          </div>
        </h2>

        {#if addingSign}
          <div class="inline-form">
            <h3 class="subhead">New LED Sign</h3>
            <div class="form-grid">
              <label>Sign name *<input bind:value={newSign.sign_name} placeholder="Main entrance marquee" /></label>
              <label>Location<input bind:value={newSign.location} /></label>
            </div>
            <p class="hint">Spec details can be filled in after the sign is created — use Edit on the row.</p>
            <div class="form-actions">
              <button class="btn btn-primary" on:click={submitNewSign} disabled={savingSign}>
                {savingSign ? 'Saving…' : 'Create sign'}
              </button>
              <button class="btn btn-ghost" on:click={() => { addingSign = false; newSign = { sign_name:'', location:'' }; }}>Cancel</button>
            </div>
          </div>
        {/if}

        {#if ledLoading && !ledLoaded}
          <p class="empty-msg">Loading…</p>
        {:else if ledError}
          <p class="empty-msg" style="color:#dc2626;">⚠ {ledError}</p>
        {:else if ledSigns.length === 0 && !addingSign}
          <p class="empty-msg">No LED signs on file for this client.</p>
        {:else}
          <div class="ref-list">
            {#each ledSigns as s}
              <div class="ref-card">
                {#if editingSignId === s.id}
                  <h3 class="subhead">Editing: {s.sign_name || '(Unnamed)'}</h3>
                  <div class="form-grid">
                    <label>Sign name<input bind:value={editSign.sign_name} /></label>
                    <label>Location<input bind:value={editSign.location} /></label>
                    <label>Control system<input bind:value={editSign.control_system} /></label>
                    <label>Pitch<input bind:value={editSign.pitch} /></label>
                    <label>Width (mm)<input type="number" step="0.1" bind:value={editSign.width_mm} /></label>
                    <label>Height (mm)<input type="number" step="0.1" bind:value={editSign.height_mm} /></label>
                    <label>Serial #<input bind:value={editSign.serial_number} /></label>
                    <label>Inventory #<input bind:value={editSign.inventory_no} /></label>
                    <label>Module size<input bind:value={editSign.module_size} /></label>
                    <label>Power supply<input bind:value={editSign.power_supply} /></label>
                    <label>ESA #<input bind:value={editSign.esa_no} /></label>
                    <label>Faces<input type="number" min="1" bind:value={editSign.faces} /></label>
                    <label>Cabinets<input type="number" min="0" bind:value={editSign.cabinets} /></label>
                    <label>Install date<input type="date" bind:value={editSign.install_date} /></label>
                    <label>Voltage<input bind:value={editSign.voltage} /></label>
                    <label>Total amp<input bind:value={editSign.total_amp} /></label>
                    <label>WiFi SSID<input bind:value={editSign.wifi_ssid} /></label>
                    <label>Cloud username<input bind:value={editSign.cloud_username} /></label>
                    <label>Cellular #<input bind:value={editSign.cellular_number} /></label>
                  </div>
                  <div class="form-actions">
                    <button class="btn btn-primary" on:click={saveEditSign} disabled={savingEditSign}>
                      {savingEditSign ? 'Saving…' : 'Save changes'}
                    </button>
                    <button class="btn btn-ghost" on:click={cancelEditSign}>Cancel</button>
                    {#if $isStaff}
                      <button class="btn btn-danger" on:click={() => deleteSign(s)} style="margin-left:auto">Delete sign</button>
                    {/if}
                  </div>
                {:else}
                  <div class="ref-header">
                    <div>
                      <div class="ref-title">{s.sign_name || '(Unnamed sign)'}</div>
                      {#if s.location}<div class="ref-sub">📍 {s.location}</div>{/if}
                    </div>
                    <div class="ref-chips">
                      <span class="chip">{fmtPitch(s.pitch)}</span>
                      <span class="chip">{s.faces || 1}-face</span>
                      {#if s.control_system}<span class="chip">{s.control_system}</span>{/if}
                      {#if $isStaff}
                        <button class="btn btn-ghost btn-sm" on:click={() => startEditSign(s)}>Edit</button>
                      {/if}
                    </div>
                  </div>

                  <table class="spec-table">
                    <tbody>
                      <tr><td>Size</td><td>{fmtSignSize(s)}</td></tr>
                      <tr><td>Module size</td><td>{s.module_size || '—'}</td></tr>
                      <tr><td>Cabinets</td><td>{s.cabinets ?? '—'}</td></tr>
                      <tr><td>Power supply</td><td>{s.power_supply || '—'}</td></tr>
                      <tr><td>Voltage / Total A</td><td>{s.voltage ? `${s.voltage}V` : '—'} / {s.total_amp ? `${s.total_amp}A` : '—'}</td></tr>
                      <tr><td>Serial #</td><td class="mono">{s.serial_number || '—'}</td></tr>
                      <tr><td>Inventory #</td><td class="mono">{s.inventory_no || '—'}</td></tr>
                      <tr><td>ESA #</td><td class="mono">{s.esa_no || '—'}</td></tr>
                      <tr><td>Installed</td><td>{fmtDate(s.install_date)}</td></tr>
                      <tr><td>Cellular</td><td>{s.cellular_number ? s.cellular_number : '—'}</td></tr>
                      <tr><td>WiFi SSID</td><td class="mono">{s.wifi_ssid || '—'}</td></tr>
                      <tr><td>Cloud user</td><td class="mono">{s.cloud_username || '—'}</td></tr>
                    </tbody>
                  </table>

                  <div class="service-bar">
                    <button class="btn-link service-toggle" on:click={() => toggleSignDetail(s.id)}>
                      {expandedSignId === s.id ? '▾' : '▸'} Service history ({s.service_history?.length || 0})
                    </button>
                    {#if $isStaff}
                      <button class="btn btn-ghost btn-sm" on:click={() => startLogService(s.id)}>+ Log service call</button>
                    {/if}
                  </div>

                  {#if loggingServiceForSignId === s.id}
                    <div class="inline-form inline-form-nested">
                      <h4 class="subhead-sm">Log service call</h4>
                      <div class="form-grid">
                        <label>Date<input type="date" bind:value={newService.service_date} /></label>
                        <label>Serviced by
                          <select bind:value={newService.serviced_by}>
                            <option value="">—</option>
                            {#each employees as emp}
                              <option value={emp.id}>{emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim()}</option>
                            {/each}
                          </select>
                        </label>
                        <label class="span-2">Issue<textarea rows="2" bind:value={newService.issue}></textarea></label>
                        <label class="span-2">Solution<textarea rows="2" bind:value={newService.solution}></textarea></label>
                      </div>
                      <div class="form-actions">
                        <button class="btn btn-primary" on:click={submitService} disabled={savingService}>
                          {savingService ? 'Saving…' : 'Save service call'}
                        </button>
                        <button class="btn btn-ghost" on:click={cancelLogService}>Cancel</button>
                      </div>
                    </div>
                  {/if}

                  {#if expandedSignId === s.id}
                    {#if !s.service_history || s.service_history.length === 0}
                      <p class="empty-msg" style="padding:8px 0 0">No service calls logged.</p>
                    {:else}
                      <table class="items-table" style="margin-top:8px">
                        <thead>
                          <tr>
                            <th style="width:110px">Date</th>
                            <th>Issue</th>
                            <th>Solution</th>
                            <th style="width:140px">By</th>
                            {#if $isStaff}<th style="width:70px"></th>{/if}
                          </tr>
                        </thead>
                        <tbody>
                          {#each s.service_history as sh}
                            <tr>
                              <td>{fmtDate(sh.service_date)}</td>
                              <td>{sh.issue || '—'}</td>
                              <td>{sh.solution || '—'}</td>
                              <td class="text-muted">{sh.serviced_by_name || '—'}</td>
                              {#if $isStaff}
                                <td><button class="btn-link-danger" on:click={() => deleteService(sh.id)}>Delete</button></td>
                              {/if}
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {/if}
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else if activeTab === 'wifi'}
      <div class="card">
        <h2 class="card-title">
          WiFi
          {#if wifiLoaded}<span class="photo-count">{wifiEntries.length}</span>{/if}
          <div class="edit-actions">
            {#if $isStaff && !addingWifi}
              <button class="btn btn-primary btn-sm" on:click={() => addingWifi = true}>+ Add WiFi</button>
            {/if}
            <button class="btn btn-ghost" on:click={() => loadWifi({ force: true })} disabled={wifiLoading} title="Refresh">
              {wifiLoading ? '…' : '⟳'}
            </button>
          </div>
        </h2>

        {#if addingWifi}
          <div class="inline-form">
            <h3 class="subhead">New WiFi entry</h3>
            <div class="form-grid">
              <label>Location<input bind:value={newWifi.location} placeholder="Back office" /></label>
              <label>SSID<input bind:value={newWifi.ssid} /></label>
              <label class="span-2">Password<input bind:value={newWifi.password} /></label>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" on:click={submitNewWifi} disabled={savingWifi}>
                {savingWifi ? 'Saving…' : 'Save'}
              </button>
              <button class="btn btn-ghost" on:click={() => { addingWifi = false; newWifi = { location:'', ssid:'', password:'' }; }}>Cancel</button>
            </div>
          </div>
        {/if}

        {#if wifiLoading && !wifiLoaded}
          <p class="empty-msg">Loading…</p>
        {:else if wifiError}
          <p class="empty-msg" style="color:#dc2626;">⚠ {wifiError}</p>
        {:else if wifiEntries.length === 0 && !addingWifi}
          <p class="empty-msg">No WiFi entries on file.</p>
        {:else if wifiEntries.length > 0}
          <table class="items-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>SSID</th>
                <th>Password</th>
                {#if $isStaff}<th style="width:140px"></th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each wifiEntries as w}
                {#if editingWifiId === w.id}
                  <tr>
                    <td><input bind:value={editWifi.location} /></td>
                    <td><input class="mono" bind:value={editWifi.ssid} /></td>
                    <td><input class="mono" bind:value={editWifi.password} /></td>
                    <td>
                      <button class="btn-link" on:click={saveEditWifi} disabled={savingWifi}>{savingWifi ? '…' : 'Save'}</button>
                      <button class="btn-link" on:click={cancelEditWifi}>Cancel</button>
                    </td>
                  </tr>
                {:else}
                  <tr>
                    <td>{w.location || '—'}</td>
                    <td class="mono">{w.ssid || '—'}</td>
                    <td class="mono">{w.password || '—'}</td>
                    {#if $isStaff}
                      <td>
                        <button class="btn-link" on:click={() => startEditWifi(w)}>Edit</button>
                        <button class="btn-link-danger" on:click={() => deleteWifiEntry(w)}>Delete</button>
                      </td>
                    {/if}
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

    {:else if activeTab === 'modules'}
      <div class="card">
        <h2 class="card-title">
          Modules
          {#if modulesLoaded}<span class="photo-count">{modules.length}</span>{/if}
          <div class="edit-actions">
            {#if $isStaff && !addingModule}
              <button class="btn btn-primary btn-sm" on:click={() => addingModule = true}>+ Add Module</button>
            {/if}
            <button class="btn btn-ghost" on:click={() => loadModules({ force: true })} disabled={modulesLoading} title="Refresh">
              {modulesLoading ? '…' : '⟳'}
            </button>
          </div>
        </h2>

        {#if addingModule}
          <div class="inline-form">
            <h3 class="subhead">New module</h3>
            <p class="hint">
              Modules live in a shared inventory across all clients. After creating, link it to one of this client's LED signs using the Link sign button.
            </p>
            <div class="form-grid">
              <label>Module ID # *<input class="mono" bind:value={newModule.module_id_no} /></label>
              <label>Starting inventory<input type="number" min="0" bind:value={newModule.starting_inventory} /></label>
              <label>On hand<input type="number" bind:value={newModule.on_hand} /></label>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" on:click={submitNewModule} disabled={savingModule}>
                {savingModule ? 'Saving…' : 'Create module'}
              </button>
              <button class="btn btn-ghost" on:click={() => { addingModule = false; newModule = { module_id_no:'', starting_inventory:'', on_hand:'' }; }}>Cancel</button>
            </div>
          </div>
        {/if}

        {#if modulesLoading && !modulesLoaded}
          <p class="empty-msg">Loading…</p>
        {:else if modulesError}
          <p class="empty-msg" style="color:#dc2626;">⚠ {modulesError}</p>
        {:else if modules.length === 0 && !addingModule}
          <p class="empty-msg">No modules linked to this client's signs yet.</p>
        {:else if modules.length > 0}
          <table class="items-table">
            <thead>
              <tr>
                <th>Module ID</th>
                <th style="text-align:right; width:110px">Starting</th>
                <th style="text-align:right; width:110px">On Hand</th>
                <th>Used By</th>
                {#if $isStaff}<th style="width:170px"></th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each modules as m}
                {#if editingModuleId === m.id}
                  <tr>
                    <td><input class="mono" bind:value={editModule.module_id_no} /></td>
                    <td><input type="number" bind:value={editModule.starting_inventory} style="text-align:right" /></td>
                    <td><input type="number" bind:value={editModule.on_hand} style="text-align:right" /></td>
                    <td class="text-muted">
                      {#if !m.signs || m.signs.length === 0}—{:else}
                        {#each m.signs as sg, i}{sg.sign_name || `Sign #${sg.id}`}{i < m.signs.length - 1 ? ', ' : ''}{/each}
                      {/if}
                    </td>
                    <td>
                      <button class="btn-link" on:click={saveEditModule} disabled={savingModule}>{savingModule ? '…' : 'Save'}</button>
                      <button class="btn-link" on:click={cancelEditModule}>Cancel</button>
                    </td>
                  </tr>
                {:else}
                  <tr>
                    <td class="mono">{m.module_id_no || '—'}</td>
                    <td style="text-align:right">{m.starting_inventory ?? '—'}</td>
                    <td style="text-align:right">
                      {#if m.on_hand == null}
                        <span class="text-muted">—</span>
                      {:else if m.on_hand <= 0}
                        <span style="color:#dc2626; font-weight:600">{m.on_hand}</span>
                      {:else}{m.on_hand}{/if}
                    </td>
                    <td>
                      {#if !m.signs || m.signs.length === 0}
                        <span class="text-muted">—</span>
                      {:else}
                        {#each m.signs as sg, i}
                          <span>
                            {sg.sign_name || `Sign #${sg.id}`}{sg.location ? ` (${sg.location})` : ''}
                            {#if $isStaff}
                              <button class="btn-link-danger" title="Unlink" on:click={() => unlinkSignFromModule(sg.id)}>✕</button>
                            {/if}
                          </span>{i < m.signs.length - 1 ? ', ' : ''}
                        {/each}
                      {/if}
                    </td>
                    {#if $isStaff}
                      <td>
                        <button class="btn-link" on:click={() => startEditModule(m)}>Edit</button>
                        <button class="btn-link" on:click={() => { pickingSignForModuleId = pickingSignForModuleId === m.id ? null : m.id; if (pickingSignForModuleId && !ledLoaded) loadLedSigns(); }}>
                          {pickingSignForModuleId === m.id ? 'Close' : 'Link sign'}
                        </button>
                        <button class="btn-link-danger" on:click={() => deleteModuleRow(m)}>Delete</button>
                      </td>
                    {/if}
                  </tr>
                  {#if pickingSignForModuleId === m.id}
                    <tr>
                      <td colspan={$isStaff ? 5 : 4}>
                        <div class="inline-form inline-form-nested">
                          <h4 class="subhead-sm">Link a sign to module {m.module_id_no}</h4>
                          {#if !ledLoaded}
                            <p class="hint">Loading this client's signs…</p>
                          {:else if ledSigns.length === 0}
                            <p class="hint">No LED signs on file yet.</p>
                          {:else}
                            <ul class="sign-picker">
                              {#each ledSigns as sg}
                                <li>
                                  <span class="mono">{sg.sign_name || `Sign #${sg.id}`}</span>
                                  {#if sg.location}<span class="text-muted"> — {sg.location}</span>{/if}
                                  {#if sg.module_id === m.id}
                                    <span class="chip chip-on">Already linked</span>
                                  {:else if sg.module_id}
                                    <button class="btn-link" on:click={() => linkSignToModule(m.id, sg.id)}>
                                      Move from module #{sg.module_id}
                                    </button>
                                  {:else}
                                    <button class="btn-link" on:click={() => linkSignToModule(m.id, sg.id)}>Link</button>
                                  {/if}
                                </li>
                              {/each}
                            </ul>
                          {/if}
                        </div>
                      </td>
                    </tr>
                  {/if}
                {/if}
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/if}
  {/if}
</div>

{#if showTermsConfirm}
  <div class="modal-backdrop" on:click={() => (showTermsConfirm = false)}>
    <div class="modal-card" on:click|stopPropagation>
      <h2 class="modal-title">Approve invoice checkout?</h2>
      <p>
        You're about to let <strong>{displayName(client)}</strong> place online
        orders <strong>without paying at checkout</strong>. Each order will create
        a QBO Invoice with a {editTerms.payment_terms_days}-day due date instead
        of a Sales Receipt.
      </p>
      <p class="hint">This is a financial trust gate. Only approve clients with established credit.</p>
      <div class="form-actions">
        <button class="btn btn-primary" on:click={saveTerms} disabled={savingTerms}>
          {savingTerms ? 'Saving…' : `Approve Net ${editTerms.payment_terms_days}`}
        </button>
        <button class="btn btn-ghost" on:click={() => (showTermsConfirm = false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

{#if showFolderModal && client}
  <FolderPickerModal
    client={{
      id:               client.id,
      client_name:      displayName(client),
      files_folder:     client.files_folder || null,
      effective_folder: client.files_folder || displayName(client)
    }}
    bind:open={showFolderModal}
    on:close={() => showFolderModal = false}
    on:saved={onFolderMatchSaved}
  />
{/if}

<style>
  .page { padding: 28px 32px; }

  .back-link {
    font-family: var(--font-display); font-size: 0.8rem;
    letter-spacing: 0.06em; color: var(--text-muted);
    text-transform: uppercase; display: inline-block; margin-bottom: 16px;
  }
  .back-link:hover { color: var(--red); }

  .job-headline { margin-bottom: 24px; }
  .job-id-tag {
    font-family: var(--font-display); font-size: 0.75rem; color: var(--text-dim);
    letter-spacing: 0.1em; text-transform: uppercase; display: block; margin-bottom: 4px;
  }
  .job-title {
    font-family: var(--font-display); font-size: 2rem; font-weight: 900;
    letter-spacing: 0.03em; color: var(--text);
  }

  .tabs {
    display: flex; gap: 4px; margin-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    background: transparent; border: none; padding: 10px 14px;
    font-family: var(--font-display); font-size: 0.85rem;
    letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent;
  }
  .tabs button:hover { color: var(--text); }
  .tabs button.active { color: var(--red); border-bottom-color: var(--red); }

  .card {
    background: var(--surface-1, #fff);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 16px 18px; margin-bottom: 16px;
  }
  .card-title {
    font-family: var(--font-display); font-size: 0.9rem;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-muted); margin: 0 0 12px;
    display: flex; align-items: center; gap: 10px;
  }
  .photo-count {
    background: var(--surface-2, #f7f7f9); padding: 2px 8px;
    border-radius: 10px; font-size: 0.75rem; font-weight: 700;
    font-family: var(--font-mono, monospace); color: var(--text);
  }
  .edit-actions { margin-left: auto; display: flex; gap: 6px; }

  .inline-form {
    background: var(--surface-2, #f7f7f9);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 14px 16px; margin: 0 0 16px;
  }
  .inline-form-nested {
    margin: 10px 0 6px; background: var(--surface-1, #fff);
  }
  .subhead {
    font-family: var(--font-display); font-size: 0.85rem;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-muted); margin: 0 0 10px;
  }
  .subhead-sm {
    font-family: var(--font-display); font-size: 0.75rem;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-muted); margin: 0 0 8px;
  }
  .form-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
  }
  .form-grid label {
    display: flex; flex-direction: column; font-size: 0.78rem;
    color: var(--text-muted); gap: 4px;
  }
  .form-grid label.span-2 { grid-column: span 2; }
  .form-grid input, .form-grid select, .form-grid textarea {
    width: 100%; padding: 6px 8px; border: 1px solid var(--border);
    border-radius: 4px; font-size: 0.9rem; font-family: inherit;
    background: var(--surface-1, #fff); color: var(--text);
  }
  .form-grid input.mono { font-family: var(--font-mono, monospace); }
  .form-actions {
    display: flex; gap: 8px; margin-top: 12px; align-items: center;
  }
  .hint { font-size: 0.8rem; color: var(--text-muted); margin: 0 0 10px; }

  .items-table { width: 100%; border-collapse: collapse; }
  .items-table th {
    text-align: left; font-family: var(--font-display);
    font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-muted); padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .items-table td {
    padding: 10px; border-bottom: 1px dotted var(--border);
    vertical-align: middle;
  }
  .items-table tr:last-child td { border-bottom: none; }

  .spec-table { width: 100%; }
  .spec-table td {
    padding: 5px 0; font-size: 0.9rem;
    border-bottom: 1px dotted var(--border); vertical-align: top;
  }
  .spec-table td:first-child {
    width: 140px; color: var(--text-muted);
    font-family: var(--font-display); font-size: 0.75rem;
    letter-spacing: 0.06em; text-transform: uppercase; padding-right: 10px;
  }
  .spec-table tr:last-child td { border-bottom: none; }

  .ref-list { display: flex; flex-direction: column; gap: 14px; }
  .ref-card {
    border: 1px solid var(--border); border-radius: 8px;
    padding: 14px 16px;
  }
  .ref-header {
    display: flex; justify-content: space-between;
    align-items: flex-start; gap: 10px; margin-bottom: 8px;
  }
  .ref-title {
    font-family: var(--font-display); font-size: 1rem; font-weight: 700; color: var(--text);
  }
  .ref-sub { font-size: 0.85rem; color: var(--text-muted); margin-top: 2px; }
  .ref-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

  .chip {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    background: var(--surface-2, #f7f7f9); color: var(--text);
    font-size: 0.72rem; font-family: var(--font-display);
    letter-spacing: 0.03em; text-transform: uppercase;
  }
  .chip-on { background: var(--green-soft, #dcfce7); color: #166534; margin-left: 6px; }

  .service-bar {
    display: flex; justify-content: space-between; align-items: center;
    gap: 10px; margin-top: 6px;
  }

  .btn-link {
    background: none; border: none; color: var(--red);
    cursor: pointer; padding: 0 4px; font-size: 0.82rem;
  }
  .btn-link:hover { text-decoration: underline; }
  .btn-link-danger {
    background: none; border: none; color: #dc2626;
    cursor: pointer; padding: 0 4px; font-size: 0.82rem;
  }
  .btn-link-danger:hover { text-decoration: underline; }

  .btn-sm { padding: 3px 10px; font-size: 0.78rem; }
  .btn-danger {
    background: #dc2626; color: #fff; border: 1px solid #dc2626;
  }
  .btn-danger:hover { background: #b91c1c; }

  .folder-row {
    display: flex; justify-content: space-between; align-items: center;
    gap: 12px;
  }
  .folder-value {
    font-size: 0.95rem; color: var(--text); font-weight: 500;
  }

  .sign-picker { list-style: none; padding: 0; margin: 0; }
  .sign-picker li {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 0; border-bottom: 1px dotted var(--border);
  }
  .sign-picker li:last-child { border-bottom: none; }

  .mono { font-family: var(--font-mono, monospace); font-size: 0.88rem; }
  .text-muted { color: var(--text-muted); }
  .empty-msg { color: var(--text-muted); font-size: 0.9rem; padding: 16px 0; }

  .terms-badge {
    display: inline-block; margin-left: 12px;
    padding: 4px 10px; border-radius: 999px;
    background: #dcfce7; color: #166534;
    font-family: var(--font-display); font-size: 0.75rem;
    font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; vertical-align: middle;
  }

  .form-grid label.checkbox {
    flex-direction: row; align-items: center; gap: 8px;
    color: var(--text); font-size: 0.9rem;
  }
  .form-grid label.checkbox input { width: auto; }

  .modal-backdrop {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .modal-card {
    background: var(--surface-1, #fff); border-radius: 8px;
    padding: 22px 24px; max-width: 500px; width: 100%;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  }
  .modal-title {
    font-family: var(--font-display); font-size: 1.1rem;
    font-weight: 800; margin: 0 0 12px;
  }
  .modal-card p { font-size: 0.92rem; color: var(--text); line-height: 1.5; margin: 0 0 12px; }
</style>
