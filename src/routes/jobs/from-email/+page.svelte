<!-- src/routes/jobs/from-email/+page.svelte -->
<!--
  New Job from a quote-request email.

  Staff open the email in Outlook, select all + copy, and paste it here.
  The paste is parsed (src/lib/jobs/quoteEmail.js), the customer is looked
  up against the client list, and one button creates — in order — the
  client (only when there's no match), the job, a note holding the full
  email, and the Job folder on L: named "Job<num> - <description>".
-->
<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';
  import { ensureJobFolder } from '$lib/files/filesBridgeClient.js';
  import {
    parseQuoteEmail, suggestJobName, clientSearchTerms,
    scoreClientMatch, splitName,
  } from '$lib/jobs/quoteEmail.js';

  let projectTypes = [];
  let statuses = [];
  let employees = [];
  let loading = true;

  let emailText = '';
  let parsed = null;
  let parseNotice = '';

  // Editable copy of what the parser found — staff fix anything it got
  // wrong before the job is created.
  let form = {
    project_name: '',
    project_type_id: '',
    status_id: '1',
    assigned_employee_id: '',
    due_date: '',
    contact: '',
    contact_phone: '',
    contact_email: '',
  };
  let company = '';

  // Client matching
  let matching = false;
  let matches = [];
  let selectedClient = null;
  let createNewClient = false;
  let manualSearch = '';
  let manualResults = [];
  let manualSearching = false;
  let searchTimeout = null;

  let creating = false;
  let createStep = '';
  let error = '';

  onMount(async () => {
    if (!$isStaff) { goto('/dashboard'); return; }
    try {
      [projectTypes, statuses, employees] = await Promise.all([
        api.getProjectTypes(), api.getStatuses(), api.getEmployees()
      ]);
      // The default '1' only sticks if the backend really numbers the first
      // status 1 — otherwise the select renders blank. Fall back to the
      // first status on file so a job never saves without one.
      if (statuses.length && !statuses.some(s => String(s.id) === String(form.status_id))) {
        form.status_id = statuses[0].id;
      }
    } catch (e) { console.error(e); }
    finally { loading = false; }
  });

  $: clientName = selectedClient
    ? (selectedClient.company_name || `${selectedClient.first_name || ''} ${selectedClient.last_name || ''}`.trim())
    : (company || parsed?.name || '');

  // What the L: folder will be called once the job number exists. Job
  // numbers come from the DB, so the number is a placeholder until save.
  // The description is put through the same scrub the bridge applies
  // (files-bridge/server.js sanitizeFolderDesc) so the preview is honest
  // about slashes and other characters Windows won't take.
  $: folderPreview = `Job#### - ${folderDesc(form.project_name) || '(description)'}`;

  function folderDesc(input) {
    return String(input || '')
      .replace(/[^A-Za-z0-9 _.\-&',()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)
      .replace(/^[.\s]+|[.\s]+$/g, '');
  }

  function readParse() {
    error = '';
    parsed = parseQuoteEmail(emailText);
    const found = ['name', 'company', 'email', 'phone', 'service'].filter(k => parsed[k]);
    parseNotice = found.length
      ? `Read ${found.join(', ')} from the email.`
      : 'Could not find the usual quote-form fields — fill in what’s missing below.';

    form.project_name = suggestJobName(parsed);
    form.contact = parsed.name;
    form.contact_email = parsed.email;
    form.contact_phone = parsed.phone;
    form.project_type_id = guessProjectType(parsed.service);
    form.due_date = parseDueDate(parsed.needBy);
    company = parsed.company;

    findClient();
  }

  function clearAll() {
    emailText = '';
    parsed = null;
    parseNotice = '';
    matches = [];
    selectedClient = null;
    createNewClient = false;
    manualSearch = '';
    manualResults = [];
    error = '';
    form = {
      project_name: '', project_type_id: '', status_id: '1',
      assigned_employee_id: '', due_date: '',
      contact: '', contact_phone: '', contact_email: '',
    };
    company = '';
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) { error = 'Clipboard is empty — copy the email first.'; return; }
      emailText = text;
      readParse();
    } catch {
      error = 'The browser blocked clipboard access — paste into the box with Ctrl+V instead.';
    }
  }

  // Best-effort map from the quote form's Service value onto one of our
  // ProjectType rows ("Vehicle Graphics / Wrap" → Vehicle Graphics).
  function guessProjectType(service) {
    const s = (service || '').toLowerCase();
    if (!s) return '';
    const words = s.split(/[^a-z]+/).filter(w => w.length > 3);
    let best = '', bestHits = 0;
    for (const t of projectTypes) {
      const name = String(t.type_name || t.project_type || '').toLowerCase();
      if (!name) continue;
      if (name === s) return t.id;
      const hits = words.filter(w => name.includes(w)).length;
      if (hits > bestHits) { bestHits = hits; best = t.id; }
    }
    return bestHits > 0 ? best : '';
  }

  // Only accept a date we're sure about — a wrong due date on the board is
  // worse than a blank one. "ASAP"/"next month" stay in the note.
  function parseDueDate(text) {
    const s = (text || '').trim();
    if (!s) return '';
    const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return iso[0];
    const d = new Date(s);
    if (!isNaN(d.getTime()) && /\d/.test(s)) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return '';
  }

  // Look the customer up by email, then company, then surname, and rank
  // whatever comes back. An exact email hit auto-selects — that's the one
  // case where we're sure it's the same person.
  async function findClient() {
    matching = true;
    matches = [];
    selectedClient = null;
    createNewClient = false;
    try {
      const terms = clientSearchTerms(parsed);
      const byId = new Map();
      for (const term of terms) {
        let rows = [];
        try { rows = await api.getClients(term); } catch (e) { console.warn('[from-email] client search failed:', e?.message || e); }
        for (const row of rows || []) {
          if (!byId.has(row.id)) byId.set(row.id, row);
        }
        // An exact email hit is conclusive — no need to keep searching.
        if (rows?.some(r => (r.email || '').toLowerCase() === (parsed.email || '').toLowerCase() && parsed.email)) break;
      }
      matches = [...byId.values()]
        .map(c => ({ ...c, match: scoreClientMatch(c, parsed) }))
        .filter(c => c.match.score > 0)
        .sort((a, b) => b.match.score - a.match.score)
        .slice(0, 8);

      const sure = matches.find(m => m.match.score === 3);
      if (sure) selectedClient = sure;
      else if (matches.length === 0) createNewClient = true;
    } finally {
      matching = false;
    }
  }

  function chooseClient(c) {
    selectedClient = c;
    createNewClient = false;
  }

  function chooseNewClient() {
    selectedClient = null;
    createNewClient = true;
  }

  function handleManualSearch() {
    clearTimeout(searchTimeout);
    if (manualSearch.trim().length < 2) { manualResults = []; return; }
    searchTimeout = setTimeout(async () => {
      manualSearching = true;
      try { manualResults = (await api.getClients(manualSearch.trim())).slice(0, 20); }
      catch (e) { console.error(e); }
      finally { manualSearching = false; }
    }, 300);
  }

  function displayName(c) {
    return c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || `Client #${c.id}`;
  }

  async function createJob() {
    error = '';
    if (!form.project_name.trim()) { error = 'Enter a job description — it names the job and the L: folder.'; return; }
    if (!selectedClient && !createNewClient) { error = 'Pick the existing client, or choose “Create new client”.'; return; }
    if (createNewClient && !company.trim() && !parsed?.name?.trim()) {
      error = 'A new client needs a company name or a contact name.';
      return;
    }

    creating = true;
    try {
      let client = selectedClient;

      // 1. Client — only when the email is from someone new.
      if (!client) {
        createStep = 'Creating client…';
        const { first, last } = splitName(parsed?.name);
        const payload = {
          company: company.trim(),
          first_name: first,
          last_name: last,
          email: (form.contact_email || '').trim(),
        };
        const res = await api.createClient(payload);
        const newId = res?.id ?? res?.client_id ?? res;
        client = { id: newId, company_name: payload.company, first_name: first, last_name: last, email: payload.email };
        // Phone lives in its own table — non-fatal if it doesn't take.
        if (form.contact_phone?.trim()) {
          try {
            await api.createClientPhone(newId, {
              number: form.contact_phone.trim(), ext: '', phone_type: 'Main',
            });
          } catch (e) { console.warn('[from-email] phone save failed:', e?.message || e); }
        }
      }

      // 2. Job.
      createStep = 'Creating job…';
      const newJob = await api.createProject({ ...form, client_id: client.id });

      // 3. Note holding the email exactly as it arrived, so the details the
      //    customer wrote are never lost to a short job description.
      createStep = 'Saving the email to the job…';
      try {
        await api.addNote(newJob.id, quoteNote());
      } catch (e) { console.warn('[from-email] note save failed:', e?.message || e); }

      // 4. Folder on L: — "Job<num> - <description>". Best-effort: the job
      //    is already saved, and the Files card can create it later.
      createStep = 'Creating the L: folder…';
      const folderFor = displayName(client);
      if (folderFor) {
        try {
          await ensureJobFolder(folderFor, newJob.id, form.project_name);
        } catch (e) { console.warn('[files-bridge] folder create failed:', e?.message || e); }
      }

      goto(`/jobs/${newJob.id}`);
    } catch (e) {
      error = e.message || String(e);
    } finally {
      creating = false;
      createStep = '';
    }
  }

  function quoteNote() {
    const lines = ['Quote request received by email.'];
    if (parsed?.service) lines.push(`Service: ${parsed.service}`);
    if (parsed?.needBy)  lines.push(`Needed by: ${parsed.needBy}`);
    lines.push('', '--- Email as received ---', parsed?.raw || emailText.trim());
    return lines.join('\n');
  }
</script>

<svelte:head><title>New Job from Email — Holm Graphics</title></svelte:head>

<div class="page">
  <a href="/dashboard" class="back-link">← Job Board</a>
  <h1 class="page-title">New Job from Email</h1>
  <p class="page-sub">
    Paste a quote-request email — we’ll read the contact details, find the client
    (or create one) and open the job ready to quote.
  </p>

  {#if loading}
    <div class="loading-state"><div class="loading-spinner"></div> Loading…</div>
  {:else}
    <div class="form-layout">

      <!-- ── 1. Paste ─────────────────────────────────────────────── -->
      <section class="card">
        <h2 class="section-title">
          1 · Paste the email
          {#if parsed}<button class="btn-link" on:click={clearAll}>Start over</button>{/if}
        </h2>
        <textarea
          class="email-box"
          rows={parsed ? 6 : 12}
          bind:value={emailText}
          on:paste={() => setTimeout(readParse, 0)}
          placeholder={'Open the email in Outlook, press Ctrl+A then Ctrl+C, and paste it here.\n\nWorks with the holmgraphics.ca quote form, the online-store quote email, or a customer just typing a note.'}
        ></textarea>
        <div class="paste-actions">
          <button class="btn btn-ghost" on:click={pasteFromClipboard}>📋 Paste from clipboard</button>
          <button class="btn btn-primary" on:click={readParse} disabled={!emailText.trim()}>Read email →</button>
        </div>
        {#if parseNotice}<p class="notice">{parseNotice}</p>{/if}
      </section>

      {#if parsed}
        <!-- ── 2. Client ──────────────────────────────────────────── -->
        <section class="card">
          <h2 class="section-title">2 · Client</h2>

          {#if matching}
            <p class="empty-msg">Checking for an existing client…</p>
          {:else}
            {#if matches.length > 0}
              <p class="notice">
                {matches.length === 1 ? '1 possible match' : `${matches.length} possible matches`} in the client list —
                pick the right one so this job files under the folder they already have.
              </p>
              <ul class="match-list">
                {#each matches as m}
                  <li>
                    <button
                      class="match-row"
                      class:selected={selectedClient?.id === m.id}
                      on:click={() => chooseClient(m)}
                    >
                      <span class="match-main">
                        <span class="match-name">{displayName(m)}</span>
                        {#if m.email}<span class="match-sub">{m.email}</span>{/if}
                      </span>
                      <span class="match-badge" class:strong={m.match.score === 3}>{m.match.why}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="empty-msg">No existing client looks like this sender.</p>
            {/if}

            <button
              class="new-client-row"
              class:selected={createNewClient}
              on:click={chooseNewClient}
            >
              ＋ Create a new client from this email
            </button>

            {#if createNewClient}
              <div class="new-client-form">
                <div class="form-row">
                  <div class="form-group">
                    <label for="nc-company">Company Name</label>
                    <input id="nc-company" bind:value={company} placeholder="Company Inc." />
                  </div>
                  <div class="form-group">
                    <label for="nc-contact">Contact Name</label>
                    <input id="nc-contact" bind:value={form.contact} placeholder="First Last" />
                  </div>
                </div>
                <p class="hint">
                  Saved as <strong>{clientName || '—'}</strong> — this is also the folder the job files under on L:.
                </p>
              </div>
            {/if}

            <div class="manual-search">
              <label for="manual-client">Not listed above? Search all clients</label>
              <input
                id="manual-client"
                bind:value={manualSearch}
                on:input={handleManualSearch}
                placeholder="Type 2+ characters…"
              />
              {#if manualSearching}
                <p class="empty-msg">Searching…</p>
              {:else if manualResults.length > 0}
                <ul class="match-list">
                  {#each manualResults as c}
                    <li>
                      <button
                        class="match-row"
                        class:selected={selectedClient?.id === c.id}
                        on:click={() => chooseClient(c)}
                      >
                        <span class="match-main">
                          <span class="match-name">{displayName(c)}</span>
                          {#if c.email}<span class="match-sub">{c.email}</span>{/if}
                        </span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </section>

        <!-- ── 3. Job ─────────────────────────────────────────────── -->
        <section class="card">
          <h2 class="section-title">3 · Job details</h2>

          <div class="form-group">
            <label for="project_name">Job Description *</label>
            <input id="project_name" bind:value={form.project_name} placeholder="e.g. Truck Letters" />
            <span class="hint">
              Also names the folder on L: — <span class="mono">{folderPreview}</span>
            </span>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="ptype">Job Type</label>
              <select id="ptype" bind:value={form.project_type_id}>
                <option value="">Select type…</option>
                {#each projectTypes as t}
                  <option value={t.id}>{t.type_name || t.project_type}</option>
                {/each}
              </select>
              {#if parsed.service}<span class="hint">Email said: {parsed.service}</span>{/if}
            </div>
            <div class="form-group">
              <label for="pstatus">Initial Status</label>
              <select id="pstatus" bind:value={form.status_id}>
                <option value="">Select status…</option>
                {#each statuses as s}
                  <option value={s.id}>{s.status_name}</option>
                {/each}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="passign">Assigned To</label>
              <select id="passign" bind:value={form.assigned_employee_id}>
                <option value="">Unassigned</option>
                {#each employees as e}
                  <option value={e.id}>{e.first_name} {e.last_name}</option>
                {/each}
              </select>
            </div>
            <div class="form-group">
              <label for="pdue">Due Date</label>
              <input id="pdue" type="date" bind:value={form.due_date} />
              {#if parsed.needBy && !form.due_date}<span class="hint">Email said: {parsed.needBy}</span>{/if}
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="pcontact">Contact Name</label>
              <input id="pcontact" bind:value={form.contact} />
            </div>
            <div class="form-group">
              <label for="pphone">Contact Phone</label>
              <input id="pphone" bind:value={form.contact_phone} />
            </div>
          </div>

          <div class="form-group">
            <label for="pemail">Contact Email</label>
            <input id="pemail" type="email" bind:value={form.contact_email} />
          </div>

          {#if parsed.details}
            <div class="form-group">
              <span class="details-label">What they asked for</span>
              <p class="details-box">{parsed.details}</p>
              <span class="hint">The full email is saved to the job as a note.</span>
            </div>
          {/if}
        </section>

        {#if error}<p class="error-msg">⚠ {error}</p>{/if}

        <div class="form-actions">
          <span class="create-summary">
            {#if selectedClient}
              Filing under <strong>{displayName(selectedClient)}</strong>
            {:else if createNewClient}
              Creating client <strong>{clientName || '—'}</strong>
            {:else}
              Pick a client to continue
            {/if}
          </span>
          <a href="/jobs/new" class="btn btn-ghost">Use the blank form instead</a>
          <button class="btn btn-primary" on:click={createJob} disabled={creating}>
            {creating ? (createStep || 'Creating…') : 'Create Job →'}
          </button>
        </div>
      {/if}

    </div>
  {/if}
</div>

<style>
  .page { padding: 28px 32px; max-width: 900px; }

  .back-link {
    font-family: var(--font-display); font-size: 0.8rem;
    letter-spacing: 0.06em; color: var(--text-muted);
    text-transform: uppercase; display: inline-block; margin-bottom: 12px;
  }
  .back-link:hover { color: var(--red); }

  .page-title {
    font-family: var(--font-display); font-size: 2rem; font-weight: 900;
    letter-spacing: 0.04em; text-transform: uppercase; color: var(--text);
  }
  .page-sub { font-size: 0.88rem; color: var(--text-muted); margin-bottom: 28px; margin-top: 4px; }

  .form-layout { display: flex; flex-direction: column; gap: 16px; }

  .section-title {
    font-family: var(--font-display); font-size: 0.78rem; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted);
    margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
  }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .email-box {
    width: 100%; font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.84rem; line-height: 1.45; resize: vertical;
  }
  .paste-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }

  .notice { font-size: 0.82rem; color: var(--text-muted); margin-top: 10px; }
  .empty-msg { font-size: 0.85rem; color: var(--text-muted); padding: 6px 0; }
  .hint { font-size: 0.76rem; color: var(--text-dim); margin-top: 4px; display: block; }
  .mono { font-family: var(--font-mono, ui-monospace, monospace); color: var(--text-muted); }

  .error-msg {
    font-size: 0.85rem; color: #dc2626; background: rgba(220, 38, 38, 0.08);
    border: 1px solid rgba(220, 38, 38, 0.3); border-radius: var(--radius);
    padding: 10px 12px;
  }

  .match-list { list-style: none; display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
  .match-row {
    width: 100%; display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 10px 12px; text-align: left; cursor: pointer;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius); transition: border-color 0.12s, background 0.12s;
  }
  .match-row:hover { background: var(--surface); border-color: var(--text-dim); }
  .match-row.selected { border-color: var(--green); background: var(--surface); }
  .match-main { display: flex; flex-direction: column; }
  .match-name { font-size: 0.95rem; color: var(--text); font-weight: 500; }
  .match-sub { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
  .match-badge {
    font-family: var(--font-display); font-size: 0.68rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--text-muted);
    border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px;
    white-space: nowrap;
  }
  .match-badge.strong { color: var(--green); border-color: var(--green); }

  .new-client-row {
    width: 100%; padding: 10px 12px; margin-top: 6px; cursor: pointer;
    text-align: left; background: none; border: 1px dashed var(--border);
    border-radius: var(--radius); color: var(--text-muted); font-size: 0.88rem;
    transition: border-color 0.12s, color 0.12s;
  }
  .new-client-row:hover { color: var(--text); border-color: var(--text-dim); }
  .new-client-row.selected { border-style: solid; border-color: var(--green); color: var(--text); }

  .new-client-form {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 16px; margin-top: 10px;
  }

  .manual-search { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); }
  .manual-search label {
    display: block; font-size: 0.78rem; color: var(--text-muted); margin-bottom: 6px;
  }

  .details-label {
    display: block; font-size: 0.78rem; color: var(--text-muted); margin-bottom: 6px;
  }
  .details-box {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 12px; font-size: 0.86rem;
    color: var(--text); white-space: pre-wrap; max-height: 220px; overflow-y: auto;
  }

  .btn-link {
    background: none; border: none; cursor: pointer;
    color: var(--red); font-size: 0.72rem; font-family: var(--font-display);
    font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 0;
  }
  .btn-link:hover { opacity: 0.7; }

  .form-actions {
    display: flex; justify-content: flex-end; align-items: center;
    gap: 10px; padding-top: 8px; flex-wrap: wrap;
  }
  .create-summary { font-size: 0.82rem; color: var(--text-muted); margin-right: auto; }

  .loading-state {
    display: flex; align-items: center; gap: 12px;
    padding: 48px; color: var(--text-muted); font-size: 0.9rem;
  }
  .loading-spinner {
    width: 20px; height: 20px; border: 2px solid var(--border);
    border-top-color: var(--red); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 700px) {
    .page { padding: 16px; }
    .form-row { grid-template-columns: 1fr; }
    .create-summary { margin-right: 0; width: 100%; }
  }
</style>
