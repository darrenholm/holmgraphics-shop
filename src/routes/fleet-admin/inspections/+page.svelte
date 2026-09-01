<!--
  /fleet-admin/inspections — today's board.

  Answers three questions in one screen, in order of how much they cost if
  you get them wrong:
    1. Is anything out of service right now?
    2. Which in-scope units have no valid check today?
    3. What has been checked, and by whom?

  "Valid" is computed from valid_until, not from "was there a check today" —
  a report is good for 24 hours from when it was signed, which is not the
  same as a calendar day.
-->
<script>
  import { onMount } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';

  let loading = true;
  let error = '';
  let scope = null;
  let recent = [];
  let schedules = [];
  let verifying = false;
  let jobs = null;
  let jobBusy = '';
  let jobMsg = '';
  let policyBusy = null;

  // Flips a unit between an expected daily check and on-demand. Deliberately
  // does not touch inspection_required — that is derived from the unit's
  // registered gross weight and records whether the regulation applies,
  // which is not ours to change from a dashboard.
  async function togglePolicy(u) {
    policyBusy = u.id; error = '';
    try {
      const next = u.inspection_policy === 'daily' ? 'on_demand' : 'daily';
      await fleetApi.setInspectionPolicy(u.id, next);
      scope = await fleetApi.inspectionScope();
    } catch (e) {
      error = e.message;
    } finally {
      policyBusy = null;
    }
  }

  const JOB_LABELS = {
    'inspection-daily-digest': 'Daily digest — 07:00 weekdays',
    'fleet-expiry-digest':     'Document expiry — 07:00 Mondays',
    'inspection-retention':    'Retention archive — 06:00 on the 1st',
  };

  onMount(load);

  async function load() {
    loading = true; error = '';
    try {
      const [s, r, sch] = await Promise.all([
        fleetApi.inspectionScope(),
        fleetApi.listInspections({ limit: 25 }),
        fleetApi.inspectionSchedules(),
      ]);
      scope = s;
      recent = r.inspections || [];
      schedules = sch.schedules || [];
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
    // Best-effort — the board is useful without it.
    fleetApi.inspectionJobs().then((j) => { jobs = j; }).catch(() => { jobs = null; });
  }

  // Forcing a run bypasses the once-per-period claim, so it does not
  // suppress the real scheduled run later the same day. Without this the
  // only way to find out whether the 07:00 digest works is to wait for 07:00.
  async function runJob(name) {
    jobBusy = name; jobMsg = ''; error = '';
    try {
      const r = await fleetApi.runInspectionJob(name);
      jobMsg = `${JOB_LABELS[name] || name}: ${JSON.stringify(r.result)}`;
      jobs = await fleetApi.inspectionJobs();
    } catch (e) {
      error = e.message;
    } finally {
      jobBusy = '';
    }
  }

  async function markVerified(scheduleId) {
    if (!confirm('Confirm that this schedule\'s item list and declaration match the official MTO source? This affects every report signed from now on.')) return;
    verifying = true;
    try {
      await fleetApi.verifySchedule(scheduleId);
      await load();
    } catch (e) {
      error = e.message;
    } finally {
      verifying = false;
    }
  }

  function fmt(ts) {
    return ts ? new Date(ts).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  $: unverified = schedules.filter((s) => !s.source_verified);
  $: inScope = (scope?.units || []).filter((u) => u.inspection_required);
  // "Overdue" is measured against the operator's policy, not against the
  // regulation: checks are run on demand, so a unit is only late if someone
  // put it on a daily policy. `inScopeOnDemand` keeps the gap between the
  // two visible rather than letting the quiet board imply there isn't one.
  $: dailyUnits = (scope?.units || []).filter((u) => u.inspection_policy === 'daily');
  $: overdue = dailyUnits.filter((u) => !u.has_valid_inspection);
  $: inScopeOnDemand = inScope.filter((u) => u.inspection_policy === 'on_demand');
  $: outOfService = (scope?.units || []).filter((u) => u.out_of_service);
  // Trailers count here too: Tr-03 is the Skyjack trailer, and whether it
  // falls under the regulation depends on an RGW nobody has read off the
  // permit yet. Leaving it silently "not required" would answer a question
  // we have not actually asked.
  $: rgwUnknown = (scope?.units || []).filter((u) => u.rgw_unknown);
</script>

<svelte:head><title>Inspections · Fleet admin</title></svelte:head>

<div class="page">
  <header class="head">
    <h1>Daily inspections</h1>
    <nav>
      <a href="/fleet-admin">Fleet</a>
      <a href="/fleet-admin/inspections/defects">Open defects</a>
    </nav>
  </header>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if error}
    <p class="alert error">{error}</p>
  {:else}

    {#if unverified.length}
      <div class="alert warn">
        <strong>Schedule not yet countersigned.</strong>
        {unverified.map((s) => s.name).join(', ')} carries the Schedule 1 text transcribed
        from Ontario e-Laws (O.&nbsp;Reg.&nbsp;199/07, current to April&nbsp;2024). It has not
        yet been read back against the official source by whoever holds the CVOR file, and
        every report signed meanwhile is stamped accordingly. Check the 23 Parts on the
        <a href="/fleet/schedule-1">schedule page</a>, then confirm here.
        {#each unverified as s}
          <button class="btn-small" disabled={verifying} on:click={() => markVerified(s.id)}>
            Mark "{s.name}" verified
          </button>
        {/each}
      </div>
    {/if}

    {#if outOfService.length}
      <div class="dno">
        <strong>OUT OF SERVICE</strong>
        {#each outOfService as u}
          <div class="dno-row">
            <span class="unit">{u.unit_number}</span>
            <span>{u.open_major_defects} major {u.open_major_defects === 1 ? 'defect' : 'defects'} open</span>
            <a href="/fleet-admin/inspections/defects">Record the repair →</a>
          </div>
        {/each}
      </div>
    {/if}

    <div class="tiles">
      <div class="tile">
        <span class="n">{scope.summary.checked_today} / {scope.summary.on_daily_policy}</span>
        <span class="l">Checked, on daily policy</span>
      </div>
      <div class="tile" class:bad={scope.summary.overdue > 0}>
        <span class="n">{scope.summary.overdue}</span>
        <span class="l">No valid check</span>
      </div>
      <div class="tile" class:bad={scope.summary.out_of_service > 0}>
        <span class="n">{scope.summary.out_of_service}</span>
        <span class="l">Out of service</span>
      </div>
      <div class="tile">
        <span class="n">{scope.summary.in_scope}</span>
        <span class="l">Covered by O. Reg. 199/07</span>
      </div>
    </div>

    {#if inScopeOnDemand.length}
      <p class="fine">
        {inScopeOnDemand.map((u) => u.unit_number).join(', ')}
        {inScopeOnDemand.length === 1 ? 'is' : 'are'} covered by O.&nbsp;Reg.&nbsp;199/07 but set
        to on-demand checks, so nothing here counts {inScopeOnDemand.length === 1 ? 'it' : 'them'}
        as overdue and no digest is sent. Switch a unit to daily in the table below to change that.
      </p>
    {/if}

    {#if overdue.length}
      <section>
        <h2>No valid inspection</h2>
        <ul class="unit-list">
          {#each overdue as u}
            <li>
              <span class="unit">{u.unit_number}</span>
              <span class="meta">{[u.year, u.make, u.model].filter(Boolean).join(' ')} · <span class="mono">{u.license_plate}</span></span>
              <span class="meta">
                {u.latest_completed_at ? `Last checked ${fmt(u.latest_completed_at)}` : 'Never checked'}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h2>Units</h2>
      <table>
        <thead>
          <tr><th>Unit</th><th>Scope</th><th>Checks</th><th>Last check</th><th>Valid until</th><th>Open defects</th></tr>
        </thead>
        <tbody>
          {#each scope.units as u}
            <tr class:oos={u.out_of_service}>
              <td>
                <strong>{u.unit_number}</strong>
                <span class="sub">{u.license_plate || '—'}</span>
              </td>
              <td>
                {#if u.inspection_required}
                  <span class="pill pill-scope">Required</span>
                  <span class="sub">{u.registered_gross_weight_kg} kg RGW</span>
                {:else if u.rgw_unknown}
                  <span class="pill pill-unknown">RGW unknown</span>
                {:else}
                  <span class="sub">Not required{u.registered_gross_weight_kg ? ` · ${u.registered_gross_weight_kg} kg RGW` : ''}</span>
                {/if}
              </td>
              <td>
                <button class="policy" class:daily={u.inspection_policy === 'daily'}
                        disabled={policyBusy === u.id}
                        title="Switch between an expected daily check and on-demand"
                        on:click={() => togglePolicy(u)}>
                  {u.inspection_policy === 'daily' ? 'Daily' : 'On demand'}
                </button>
              </td>
              <td>
                {#if u.latest_inspection_id}
                  <a href={`/fleet/check/${u.latest_inspection_id}`}>{fmt(u.latest_completed_at)}</a>
                  <span class="sub">{u.latest_inspector_name}</span>
                {:else}—{/if}
              </td>
              <td>
                {#if u.has_valid_inspection}
                  <span class="pill pill-ok">{fmt(u.latest_valid_until)}</span>
                {:else if u.latest_valid_until}
                  <span class="pill pill-expired">Expired</span>
                {:else}—{/if}
              </td>
              <td>
                {#if u.open_major_defects}<span class="pill pill-major">{u.open_major_defects} major</span>{/if}
                {#if u.open_minor_defects}<span class="pill pill-minor">{u.open_minor_defects} minor</span>{/if}
                {#if !u.open_major_defects && !u.open_minor_defects}—{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if rgwUnknown.length}
        <p class="fine">
          {rgwUnknown.length} unit{rgwUnknown.length === 1 ? ' has' : 's have'} no registered
          gross weight on file ({rgwUnknown.map((u) => u.unit_number).join(', ')}), so scope
          cannot be determined and they are currently treated as out. Read it off each permit
          and set it on the vehicle — RGW is what decides whether O.&nbsp;Reg.&nbsp;199/07
          applies, and a trailer over 4,500&nbsp;kg needs its own schedule rather than
          Schedule&nbsp;1.
        </p>
      {/if}
    </section>

    {#if jobs}
      <section>
        <h2>Scheduled jobs</h2>
        {#if jobMsg}<p class="alert ok">{jobMsg}</p>{/if}
        <table>
          <thead>
            <tr><th>Job</th><th>Last run</th><th>Result</th><th></th></tr>
          </thead>
          <tbody>
            {#each Object.keys(JOB_LABELS) as name}
              {@const run = jobs.runs.find((r) => r.job_name === name)}
              <tr>
                <td><strong>{JOB_LABELS[name]}</strong><span class="sub">{name}</span></td>
                <td>
                  {#if run}{fmt(run.started_at)}<span class="sub">{run.run_key}</span>
                  {:else}<span class="sub">never</span>{/if}
                </td>
                <td>
                  {#if !run}—
                  {:else if run.ok === true}<span class="pill pill-ok">ok</span>
                  {:else if run.ok === false}<span class="pill pill-major">failed</span>
                  {:else}<span class="pill pill-draft">running</span>{/if}
                  {#if run?.detail}<span class="sub">{JSON.stringify(run.detail)}</span>{/if}
                </td>
                <td>
                  <button class="btn-small" disabled={jobBusy === name} on:click={() => runJob(name)}>
                    {jobBusy === name ? 'Running…' : 'Run now'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="fine">
          Windows are shop-local ({jobs.shop_time?.date} {String(jobs.shop_time?.hour).padStart(2, '0')}:{String(jobs.shop_time?.minute).padStart(2, '0')}).
          "Run now" forces a run without consuming the day's slot, so the scheduled run still fires.
        </p>
      </section>
    {/if}

    <section>
      <h2>Recent reports</h2>
      <table>
        <thead>
          <tr><th>Unit</th><th>Completed</th><th>Inspector</th><th>Odometer</th><th>Result</th></tr>
        </thead>
        <tbody>
          {#each recent as i}
            <tr>
              <td><a href={`/fleet/check/${i.id}`}><strong>{i.unit_number}</strong></a></td>
              <td>{fmt(i.completed_at)}</td>
              <td>{i.inspector_name}</td>
              <td>{i.odometer_km != null ? `${i.odometer_km} km` : '—'} <span class="sub">{i.odometer_source || ''}</span></td>
              <td>
                {#if i.status === 'out_of_service'}<span class="pill pill-major">Out of service</span>
                {:else if i.status === 'in_progress'}<span class="pill pill-draft">Draft</span>
                {:else if i.status === 'superseded'}<span class="pill pill-super">Superseded</span>
                {:else if i.no_defects}<span class="pill pill-ok">No defects</span>
                {:else}<span class="pill pill-minor">{i.defect_count} defect{i.defect_count === 1 ? '' : 's'}</span>{/if}
              </td>
            </tr>
          {:else}
            <tr><td colspan="5" class="empty">No reports yet.</td></tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
</div>

<style>
  .page { max-width: 62rem; margin: 0 auto; padding: 1rem 1rem 4rem; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 1.3rem; }
  .head nav { display: flex; gap: 1rem; }
  .head nav a { color: #c01818; text-decoration: none; font-size: 0.9rem; font-weight: 600; }
  h2 { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.04em; color: #777; margin: 1.8rem 0 0.6rem; }
  .hint { color: #666; text-align: center; padding: 2rem; }
  .fine { color: #777; font-size: 0.82rem; margin-top: 0.6rem; }
  .mono { font-family: ui-monospace, monospace; }
  .sub { display: block; color: #888; font-size: 0.78rem; }

  .alert { padding: 0.8rem 0.95rem; border-radius: 0.45rem; margin: 1rem 0; font-size: 0.9rem; line-height: 1.5; }
  .alert.error { background: #fee; color: #a10000; }
  .alert.warn  { background: #fdf5d3; color: #6c5300; }
  .alert.ok    { background: #e8f6ec; color: #1f6b34; }

  .dno { border: 2px solid #a10000; background: #fff5f5; border-radius: 0.5rem; padding: 0.9rem 1rem; margin: 1rem 0; }
  .dno > strong { display: block; color: #a10000; letter-spacing: 0.04em; margin-bottom: 0.5rem; }
  .dno-row { display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap; padding: 0.3rem 0; }
  .dno-row .unit { font-weight: 700; font-size: 1.05rem; }
  .dno-row a { color: #a10000; font-weight: 600; font-size: 0.88rem; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.7rem; margin: 1.2rem 0; }
  .tile { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 0.9rem 1rem; }
  .tile.bad { border-color: #e0b400; background: #fffdf3; }
  .tile .n { display: block; font-size: 1.7rem; font-weight: 700; line-height: 1.1; }
  .tile .l { display: block; color: #777; font-size: 0.82rem; margin-top: 0.15rem; }

  .unit-list { list-style: none; margin: 0; padding: 0; }
  .unit-list li { display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap;
                  background: white; border: 1px solid #e4e4e7; border-radius: 0.45rem;
                  padding: 0.6rem 0.85rem; margin-bottom: 0.4rem; }
  .unit-list .unit { font-weight: 700; font-size: 1.05rem; }
  .unit-list .meta { color: #666; font-size: 0.85rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; background: white; }
  th { text-align: left; color: #888; font-weight: 600; font-size: 0.72rem; text-transform: uppercase;
       letter-spacing: 0.03em; border-bottom: 1px solid #ddd; padding: 0.4rem 0.6rem; }
  td { padding: 0.55rem 0.6rem; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  tr.oos { background: #fff8f8; }
  td a { color: #1c4e8a; text-decoration: none; }
  .empty { color: #999; text-align: center; padding: 1.5rem; }

  .pill { display: inline-block; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem;
          border-radius: 999px; white-space: nowrap; margin-right: 0.25rem; }
  .pill-ok      { background: #e8f6ec; color: #1f6b34; }
  .pill-expired { background: #f0f0f0; color: #777; }
  .pill-major   { background: #fee; color: #a10000; }
  .pill-minor   { background: #fdf5d3; color: #6c5300; }
  .pill-scope   { background: #e8f0fb; color: #1c4e8a; }
  .pill-unknown { background: #f4ecfb; color: #6b3fa0; }
  .pill-draft   { background: #fdf5d3; color: #6c5300; }
  .pill-super   { background: #eef2f7; color: #45607d; }

  .policy { font: inherit; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem;
            border-radius: 999px; border: 1px solid #d4d4d8; background: #f6f6f7;
            color: #666; cursor: pointer; white-space: nowrap; }
  .policy.daily { background: #e8f0fb; border-color: #a8c4e8; color: #1c4e8a; }
  .policy:disabled { opacity: 0.5; cursor: default; }

  .btn-small { display: inline-block; margin: 0.5rem 0.4rem 0 0; padding: 0.45rem 0.85rem;
               font: inherit; font-size: 0.85rem; font-weight: 600; border: 1px solid #c4a300;
               border-radius: 0.4rem; background: white; color: #6c5300; cursor: pointer; }

  @media (max-width: 44rem) {
    table { display: block; overflow-x: auto; white-space: nowrap; }
  }
</style>
