<!--
  /fleet/check/[id] — the inspection report, read-only.

  This is the document. An officer at the roadside looks at this screen, and
  an auditor prints it six months later. So it renders ONLY the values that
  were snapshotted onto the inspection row at completion — carrier name,
  plate, jurisdiction, inspector name, declaration wording, odometer,
  location, time. Nothing here is joined out of a live table, because a
  re-plated truck or a renamed carrier must not change what a signed report
  says.

  The print stylesheet at the bottom is not decoration: "printable report" is
  a requirement, and a report that prints with a nav sidebar across it is not
  one.
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { fleetApi } from '$lib/api/fleet-client.js';
  import { cachedReportById } from '$lib/fleet/offline-store.js';

  let loading = true;
  let error = '';
  let inspection = null;
  let defects = [];
  let photoUrls = {};   // defect id → object URL
  let fromCache = false;
  let cacheReason = '';   // 'offline' | 'session'

  $: id = $page.params.id;

  onMount(async () => {
    try {
      const data = await fleetApi.getInspection(id);
      inspection = data.inspection;
      defects = data.defects || [];
      for (const d of defects) {
        if (!d.photo_path) continue;
        fleetApi.fetchDefectPhotoBlob(d.id)
          .then((r) => { photoUrls = { ...photoUrls, [d.id]: r.url }; })
          .catch(() => {});
      }
    } catch (e) {
      // Two ways to end up without a live answer, and both must still show
      // the report: no signal (throws with no status), or an expired session
      // (401). The second is the one that used to bounce the driver to a
      // login screen — with an officer waiting — and it only happened when
      // they HAD a connection. Any other HTTP error is a real error.
      const degradable = e?.status === undefined || e?.status === 401;
      const cached = degradable ? await cachedReportById(id) : null;
      if (cached) {
        inspection = cached;
        defects = [];
        fromCache = true;
        cacheReason = e?.status === 401 ? 'session' : 'offline';
      } else {
        error = e?.status === 401
          ? 'Your session has expired, and this report is not cached on this device. Sign in to view it.'
          : e.message;
      }
    } finally {
      loading = false;
    }
  });

  function fmt(ts) {
    return ts ? new Date(ts).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  $: expired = inspection?.valid_until && new Date(inspection.valid_until) < new Date();
  $: majors = defects.filter((d) => d.severity === 'major');
</script>

<svelte:head>
  <title>{inspection ? `Inspection ${inspection.id} · ${inspection.unit_number}` : 'Inspection report'} · Holm Graphics</title>
</svelte:head>

<div class="page">
  {#if loading}
    <p class="hint">Loading…</p>
  {:else if error}
    <p class="alert error">{error}</p>
  {:else if inspection}
    <div class="actions no-print">
      <a href="/fleet/check">← Back</a>
      <button on:click={() => window.print()}>Print / PDF</button>
    </div>

    <!-- Status band: the first thing anyone looking at this needs to know. -->
    {#if inspection.status === 'out_of_service'}
      <div class="band band-dno">DO NOT OPERATE — major defect recorded</div>
    {:else if inspection.status === 'superseded'}
      <div class="band band-super">Superseded by a later report</div>
    {:else if inspection.status === 'in_progress'}
      <div class="band band-draft">Draft — not yet signed</div>
    {:else if expired}
      <div class="band band-expired">Expired — a report is valid for 24 hours</div>
    {:else}
      <div class="band band-valid">Valid until {fmt(inspection.valid_until)}</div>
    {/if}

    <header class="doc-head">
      <div>
        <h1>Daily Inspection Report</h1>
        <p class="reg">{inspection.schedule_name} · {inspection.reg_reference}</p>
      </div>
      <div class="carrier">{inspection.carrier_name}</div>
    </header>

    {#if fromCache}
      <p class="alert warn">
        {#if cacheReason === 'session'}
          <strong>Offline copy — your session has expired.</strong> The report below is as
          signed and is safe to show. Sign in again when you are done to see photos and any
          repair recorded since.
        {:else}
          <strong>Offline copy.</strong> Shown from this device's cache. The report fields
          below are as signed; defect photos and any repair recorded since are not
          available without a connection.
        {/if}
      </p>
    {/if}

    {#if inspection.schedule_source_verified === false}
      <p class="alert warn no-print">
        <strong>Schedule not yet countersigned.</strong> The defect wording on this report
        was transcribed from Ontario e-Laws but has not been read back against the official
        source by whoever holds the CVOR file.
      </p>
    {/if}

    <!-- Every field O. Reg. 199/07 requires on the report, in one block. -->
    <dl class="fields">
      <div><dt>Unit</dt><dd>{inspection.unit_number} — {[inspection.year, inspection.make, inspection.model].filter(Boolean).join(' ')}</dd></div>
      <div><dt>Plate</dt><dd class="mono">{inspection.plate} ({inspection.plate_jurisdiction})</dd></div>
      <div><dt>Date and time</dt><dd>{fmt(inspection.completed_at)}</dd></div>
      <div><dt>Location</dt><dd>
        {inspection.location_text || '—'}
        <span class="src">{inspection.location_source || '—'}</span>
        {#if inspection.location_lat != null}
          <span class="coords">{Number(inspection.location_lat).toFixed(5)}, {Number(inspection.location_lng).toFixed(5)}</span>
        {/if}
      </dd></div>
      <div><dt>Inspector</dt><dd>{inspection.inspector_name}</dd></div>
      <div><dt>Odometer</dt><dd>
        {inspection.odometer_km != null ? `${inspection.odometer_km} km` : '—'}
        <span class="src">{inspection.odometer_source || '—'}</span>
        {#if inspection.odometer_reading_at}
          <span class="coords">sampled {fmt(inspection.odometer_reading_at)}</span>
        {/if}
      </dd></div>
      {#if inspection.towing_unit_number}
        <div><dt>Trailer drawn</dt><dd>{inspection.towing_unit_number}{inspection.towing_plate ? ` · ${inspection.towing_plate}` : ''}</dd></div>
      {/if}
      {#if inspection.driver_signature_name}
        <div><dt>Driver signature</dt><dd>{inspection.driver_signature_name} · {fmt(inspection.driver_signature_at)}</dd></div>
      {/if}
      {#if inspection.supersedes_id}
        <div><dt>Supersedes</dt><dd><a href={`/fleet/check/${inspection.supersedes_id}`}>Report {inspection.supersedes_id}</a></dd></div>
      {/if}
    </dl>

    <!-- Defects, or the explicit statement that none were found. The
         regulation requires one or the other; an empty section is not it. -->
    <section class="defects">
      <h2>Defects</h2>
      {#if inspection.no_defects}
        <p class="none-found">No defects were found on this inspection.</p>
      {:else if defects.length === 0}
        <p class="alert warn">This report records neither defects nor a statement that none were found.</p>
      {:else}
        {#if majors.length}
          <p class="major-lede">
            {majors.length} major {majors.length === 1 ? 'defect' : 'defects'} — the unit was
            placed out of service.
          </p>
        {/if}
        <ul class="defect-list">
          {#each defects as d}
            <li class="defect defect-{d.severity}">
              <div class="defect-head">
                <strong>{d.part_number ? `Part ${d.part_number}. ` : ''}{d.group_name}</strong>
                <span class="sev sev-{d.severity}">{d.severity}</span>
              </div>
              <p class="reg-text">
                {#if d.condition_note}<em>{d.condition_note}:</em> {/if}
                {#if d.item_label}{d.item_label}{:else}{d.severity === 'major' ? d.major_defect_text : d.minor_defect_text}{/if}
              </p>
              {#if d.note}<p class="note">Note: {d.note}</p>{/if}
              {#if d.carried_from_id}<p class="carried">Carried forward from an earlier report.</p>{/if}
              {#if d.resolved_at}
                <p class="repair">
                  Repaired {fmt(d.resolved_at)}{d.resolved_by_name ? ` by ${d.resolved_by_name}` : ''} — {d.repair_note}
                </p>
              {:else}
                <p class="open">Open — not yet repaired.</p>
              {/if}
              {#if photoUrls[d.id]}
                <img class="photo" src={photoUrls[d.id]} alt={`Defect: ${d.item_label}`} />
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Warnings the driver was shown at the time. Part of the audit trail:
         it shows they were told, which is the point of not blocking them. -->
    {#if inspection.warnings?.length}
      <section class="warnings">
        <h2>Recorded at the time of the check</h2>
        <ul>
          {#each inspection.warnings as w}<li>{w.message}</li>{/each}
        </ul>
      </section>
    {/if}

    {#if inspection.declaration_text}
      <section class="declaration">
        <h2>Declaration</h2>
        <p>{inspection.declaration_text}</p>
        <p class="signed">
          Accepted by {inspection.inspector_name} on {fmt(inspection.declaration_accepted_at)}.
          Electronic record — no handwritten signature is required under O.&nbsp;Reg.&nbsp;199/07.
        </p>
      </section>
    {/if}

    <footer class="doc-foot">
      Report {inspection.id} · generated {fmt(new Date())} ·
      the applicable schedule must be carried with this report
      (<a href="/fleet/schedule-1">view</a>).
    </footer>
  {/if}
</div>

<style>
  .page { max-width: 44rem; margin: 0 auto; padding: 1rem 1rem 4rem; color: #1a1a1a; }
  .hint { color: #666; text-align: center; padding: 2rem; }
  .mono { font-family: ui-monospace, monospace; }

  .actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.9rem; }
  .actions a { color: #666; text-decoration: none; font-size: 0.9rem; }
  .actions button { padding: 0.5rem 1rem; font: inherit; font-weight: 600; border: 1px solid #c4c4c8;
                    border-radius: 0.4rem; background: white; cursor: pointer; }

  .band { padding: 0.7rem 0.95rem; border-radius: 0.4rem; font-weight: 700; margin-bottom: 1rem; }
  .band-valid   { background: #e8f6ec; color: #1f6b34; }
  .band-expired { background: #f0f0f0; color: #666; }
  .band-dno     { background: #a10000; color: white; letter-spacing: 0.03em; }
  .band-super   { background: #eef2f7; color: #45607d; }
  .band-draft   { background: #fdf5d3; color: #6c5300; }

  .doc-head { display: flex; justify-content: space-between; align-items: flex-start;
              gap: 1rem; border-bottom: 2px solid #1a1a1a; padding-bottom: 0.7rem; }
  .doc-head h1 { margin: 0; font-size: 1.25rem; }
  .reg { margin: 0.15rem 0 0; color: #666; font-size: 0.85rem; }
  .carrier { font-weight: 700; text-align: right; font-size: 0.95rem; }

  .alert { padding: 0.7rem 0.85rem; border-radius: 0.4rem; margin: 0.8rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #a10000; }
  .alert.warn  { background: #fdf5d3; color: #6c5300; }

  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0.1rem 1.5rem; margin: 1rem 0 1.5rem; }
  .fields > div { padding: 0.45rem 0; border-bottom: 1px solid #eee; }
  dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: #888; margin-bottom: 0.12rem; }
  dd { margin: 0; font-size: 0.95rem; }
  .src { display: inline-block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
         background: #f0f0f0; color: #666; padding: 0.1rem 0.4rem; border-radius: 0.25rem; margin-left: 0.35rem; }
  .coords { display: block; font-size: 0.78rem; color: #888; font-family: ui-monospace, monospace; }

  h2 { font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.04em; color: #666;
       border-bottom: 1px solid #ddd; padding-bottom: 0.3rem; margin: 1.6rem 0 0.7rem; }

  .none-found { font-weight: 600; color: #1f6b34; margin: 0; }
  .major-lede { font-weight: 700; color: #a10000; margin: 0 0 0.7rem; }
  .defect-list { list-style: none; margin: 0; padding: 0; }
  .defect { border-left: 4px solid #ddd; padding: 0.6rem 0 0.6rem 0.85rem; margin-bottom: 0.7rem; }
  .defect-minor { border-left-color: #e0b400; }
  .defect-major { border-left-color: #a10000; }
  .defect-head { display: flex; justify-content: space-between; gap: 0.6rem; align-items: baseline; }
  .sev { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; padding: 0.12rem 0.45rem; border-radius: 999px; }
  .sev-minor { background: #fdf5d3; color: #6c5300; }
  .sev-major { background: #fee; color: #a10000; }
  .reg-text { margin: 0.25rem 0; font-size: 0.88rem; color: #444; }
  .note, .carried, .open, .repair { margin: 0.2rem 0 0; font-size: 0.85rem; }
  .note { color: #333; }
  .carried { color: #6c5300; }
  .open { color: #a10000; font-weight: 600; }
  .repair { color: #1f6b34; }
  .photo { display: block; max-width: 100%; margin-top: 0.5rem; border-radius: 0.35rem; border: 1px solid #ddd; }

  .warnings ul { margin: 0; padding-left: 1.2rem; font-size: 0.88rem; color: #6c5300; }
  .declaration p { font-size: 0.9rem; line-height: 1.55; margin: 0 0 0.5rem; }
  .signed { color: #666; font-size: 0.82rem; }
  .doc-foot { margin-top: 2rem; padding-top: 0.7rem; border-top: 1px solid #eee;
              color: #888; font-size: 0.78rem; }

  @media (max-width: 34rem) {
    .fields { grid-template-columns: 1fr; }
    .doc-head { flex-direction: column; }
    .carrier { text-align: left; }
  }

  /* An officer or auditor gets the document, not the app around it. */
  @media print {
    :global(body) { background: white; }
    :global(nav), :global(header.app-header), :global(aside), :global(.sidebar) { display: none !important; }
    .no-print { display: none !important; }
    .page { max-width: none; padding: 0; }
    .band { border: 1px solid #333; }
    .band-dno { background: white; color: #a10000; border-color: #a10000; border-width: 2px; }
    .defect, .fields > div { break-inside: avoid; }
    .photo { max-width: 8cm; }
    a { color: inherit; text-decoration: none; }
  }
</style>
