<!--
  /admin/task-templates — manage the per-sign-type task templates that
  Phase 2's "Apply template" button on the job Schedule tab uses.

  Two-pane layout:
    Left  — list of templates (active + inactive toggle, "+ new" button)
    Right — selected template's steps (drag-reorder NOT in this cut;
            users edit step_order numerically — Gantt seed templates
            already use 10, 20, 30 spacing so manual reordering is rare)
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { isAdmin, isStaff } from '$lib/stores/auth.js';

  let templates = [];
  let selected  = null;   // full template w/ steps
  let resources = [];
  let loading   = true;
  let err       = '';
  let showInactive = false;

  // New step draft
  let newStep = emptyStep();
  function emptyStep() {
    return { name: '', default_duration_days: 1, default_resource_id: '', depends_on_order: '', task_kind: 'labor', notes: '' };
  }
  // New template draft
  let newTplName = '';

  async function loadList() {
    loading = true; err = '';
    try {
      const [tplResp, resResp] = await Promise.all([
        api.listTemplates(showInactive),
        api.listResources(),
      ]);
      templates = tplResp.templates || [];
      resources = resResp.resources || [];
      if (selected) selected = templates.find((t) => t.id === selected.id) || null;
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }
  onMount(loadList);

  async function selectTemplate(t) {
    try {
      selected = await api.getTemplate(t.id);
    } catch (e) { err = e.message; }
  }

  async function createTemplate() {
    if (!newTplName.trim()) return;
    try {
      const t = await api.createTemplate({ name: newTplName.trim() });
      newTplName = '';
      await loadList();
      await selectTemplate(t);
    } catch (e) { err = e.message; }
  }

  async function patchTemplate(t, patch) {
    try {
      await api.updateTemplate(t.id, patch);
      await loadList();
      if (selected?.id === t.id) selected = await api.getTemplate(t.id);
    } catch (e) { err = e.message; }
  }

  async function patchStep(step, patch) {
    try {
      await api.updateTemplateStep(step.id, patch);
      selected = await api.getTemplate(selected.id);
    } catch (e) { err = e.message; }
  }
  async function deleteStep(step) {
    if (!confirm(`Delete "${step.name}"?`)) return;
    try {
      await api.deleteTemplateStep(step.id);
      selected = await api.getTemplate(selected.id);
    } catch (e) { err = e.message; }
  }
  async function addStep() {
    if (!newStep.name.trim()) { err = 'Step name required.'; return; }
    try {
      await api.addTemplateStep(selected.id, {
        name: newStep.name.trim(),
        default_duration_days: Number(newStep.default_duration_days) || 1,
        default_resource_id:   newStep.default_resource_id || null,
        depends_on_order:      newStep.depends_on_order ? Number(newStep.depends_on_order) : null,
        task_kind:             newStep.task_kind,
        notes:                 newStep.notes || null,
      });
      newStep = emptyStep();
      selected = await api.getTemplate(selected.id);
    } catch (e) { err = e.message; }
  }
</script>

<svelte:head><title>Task Templates — Holm Graphics</title></svelte:head>

<div class="tpl-page">
  <header><h1>Task templates</h1>
    <p class="muted small">Sign-type task lists that auto-generate per-job tasks when applied from a job's Schedule tab.</p>
  </header>

  {#if err}<div class="error inline">{err}</div>{/if}
  {#if loading}<p class="muted">Loading…</p>{/if}

  <div class="layout">
    <aside class="tpl-list card">
      <h2 class="card-title">Templates</h2>
      <label class="muted small">
        <input type="checkbox" bind:checked={showInactive} on:change={loadList} /> Show inactive
      </label>
      <ul>
        {#each templates as t (t.id)}
          <li class:active={selected?.id === t.id}>
            <button class="tpl-pick" on:click={() => selectTemplate(t)}>
              <strong>{t.name}</strong>
              <span class="muted small">{t.step_count} step{t.step_count === 1 ? '' : 's'}</span>
              {#if !t.active}<span class="pill inactive">inactive</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if $isAdmin}
        <div class="new-tpl">
          <input bind:value={newTplName} placeholder="New template name" />
          <button class="btn btn-primary" on:click={createTemplate} disabled={!newTplName.trim()}>+ Add</button>
        </div>
      {/if}
    </aside>

    <main class="tpl-detail card">
      {#if !selected}
        <p class="muted">Pick a template on the left to edit its steps.</p>
      {:else}
        <div class="detail-head">
          <h2 class="card-title">
            <input
              class="title-input"
              value={selected.name}
              on:change={(e) => patchTemplate(selected, { name: e.currentTarget.value })}
            />
          </h2>
          <label class="muted small">
            <input type="checkbox" checked={selected.active}
                   on:change={(e) => patchTemplate(selected, { active: e.currentTarget.checked })} />
            Active
          </label>
        </div>

        <table class="step-table">
          <thead>
            <tr><th>Order</th><th>Step</th><th>Days</th><th>Resource</th><th>Depends on</th><th>Kind</th><th></th></tr>
          </thead>
          <tbody>
            {#each selected.steps as s (s.id)}
              <tr>
                <td>
                  <input type="number" min="0" step="10" value={s.step_order}
                         on:change={(e) => patchStep(s, { step_order: Number(e.currentTarget.value) })} />
                </td>
                <td>
                  <input value={s.name}
                         on:change={(e) => patchStep(s, { name: e.currentTarget.value })} />
                </td>
                <td>
                  <input type="number" min="0" step="0.5" value={s.default_duration_days}
                         on:change={(e) => patchStep(s, { default_duration_days: Number(e.currentTarget.value) })} />
                </td>
                <td>
                  <select value={s.default_resource_id || ''}
                          on:change={(e) => patchStep(s, { default_resource_id: e.currentTarget.value || null })}>
                    <option value="">—</option>
                    {#each resources as r}<option value={r.id}>{r.name}</option>{/each}
                  </select>
                </td>
                <td>
                  <input type="number" min="0" step="10" value={s.depends_on_order || ''}
                         on:change={(e) => patchStep(s, { depends_on_order: e.currentTarget.value ? Number(e.currentTarget.value) : null })} />
                </td>
                <td>
                  <select value={s.task_kind}
                          on:change={(e) => patchStep(s, { task_kind: e.currentTarget.value })}>
                    <option value="labor">Labor</option>
                    <option value="customer_wait">Customer wait</option>
                    <option value="vendor_wait">Vendor wait</option>
                    <option value="permit">Permit</option>
                    <option value="milestone">Milestone</option>
                  </select>
                </td>
                <td><button class="btn btn-danger-ghost" on:click={() => deleteStep(s)}>×</button></td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- Add step row ----------------------------------------------- -->
        <h3>Add step</h3>
        <div class="add-row">
          <input bind:value={newStep.name} placeholder="Step name (e.g. Design)" />
          <input type="number" min="0" step="0.5" bind:value={newStep.default_duration_days} placeholder="Days" />
          <select bind:value={newStep.default_resource_id}>
            <option value="">— resource —</option>
            {#each resources as r}<option value={r.id}>{r.name}</option>{/each}
          </select>
          <input type="number" min="0" step="10" bind:value={newStep.depends_on_order} placeholder="Depends on (order #)" />
          <select bind:value={newStep.task_kind}>
            <option value="labor">Labor</option>
            <option value="customer_wait">Customer wait</option>
            <option value="vendor_wait">Vendor wait</option>
            <option value="permit">Permit</option>
            <option value="milestone">Milestone</option>
          </select>
          <button class="btn btn-primary" on:click={addStep}>Add</button>
        </div>
      {/if}
    </main>
  </div>
</div>

<style>
  .tpl-page { padding: 16px; }
  .tpl-page header h1 { margin: 0; }
  .muted { color: #64748b; }
  .small { font-size: 0.85rem; }
  .error.inline { background: #fef2f2; color: #991b1b; padding: 8px 12px; border-radius: 4px; margin: 8px 0; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; }
  .card-title { margin: 0 0 8px; font-size: 1.05rem; }

  .layout { display: grid; grid-template-columns: 260px 1fr; gap: 12px; margin-top: 12px; }
  @media (max-width: 768px) { .layout { grid-template-columns: 1fr; } }

  .tpl-list ul { list-style: none; padding: 0; margin: 8px 0 12px; }
  .tpl-list li { margin-bottom: 4px; }
  .tpl-pick {
    display: flex; flex-direction: column; gap: 2px;
    width: 100%; text-align: left;
    padding: 8px 10px; border: 1px solid transparent; border-radius: 4px;
    background: #f8fafc; cursor: pointer;
  }
  .tpl-list li.active .tpl-pick { background: #e0f2fe; border-color: #38bdf8; }
  .tpl-pick:hover { background: #e2e8f0; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 99px; font-size: 0.7rem; }
  .pill.inactive { background: #e2e8f0; color: #475569; }
  .new-tpl { display: flex; gap: 6px; margin-top: 8px; }
  .new-tpl input { flex: 1; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 3px; }

  .detail-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 8px; }
  .title-input { font-size: 1.05rem; font-weight: 700; border: 0; background: transparent; padding: 4px 6px; border-bottom: 2px dashed transparent; }
  .title-input:focus { border-bottom-color: #38bdf8; outline: none; }

  .step-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .step-table th, .step-table td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
  .step-table input, .step-table select { padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 3px; font-size: 0.85rem; max-width: 100%; }
  .add-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1.5fr 1fr 1.5fr auto;
    gap: 6px;
    margin-top: 10px;
  }
  .add-row input, .add-row select { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 3px; }

  .btn { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; cursor: pointer; font: inherit; }
  .btn-primary { background: #c01818; color: #fff; border-color: #c01818; }
  .btn-danger-ghost { background: transparent; color: #b91c1c; border: 1px solid #fecaca; }
</style>
