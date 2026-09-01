<!--
  /fleet/check — daily vehicle inspection (circle check), O. Reg. 199/07.

  This screen produces a legal record, and the two design decisions that
  matter most are about what it REFUSES to do:

  1. It never lets a driver record a major defect and carry on. Flagging a
     defect the regulation prints as major flips the whole completion panel
     to DO NOT OPERATE; there is no "submit and go" button left to press.
     Note the driver does NOT choose the severity — O. Reg. 199/07 lists
     each defect under either the Minor or the Major column, so that was
     decided by the regulation. The driver says whether it is present.
  2. It never silently accepts a number. A telematics odometer older than two
     hours, or from a truck with the ignition off, arrives as a suggestion
     the driver has to confirm — and confirming an edited value records it as
     'manual', because provenance is the point.

  The other thing it tries hard to do is stay fast. Schedule 1 has 76 listed
  defects across 23 Parts, and a driver tapping through all of them starts
  pencil-whipping by week two. So Parts are collapsed with a per-Part
  "All OK" that is one tap; you only open a Part when something is actually
  wrong with it.
-->
<script>
  import { onMount, tick } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';
  import * as offlineStore from '$lib/fleet/offline-store.js';

  // ── page state ──
  let loading = true;
  let error = '';
  let saving = false;

  let prefill = null;          // GET /fleet/inspections/prefill
  let scope = null;            // GET /fleet/inspections/scope — the unit picker
  let inspection = null;       // the draft row (server row, or a local stand-in)
  let defects = [];            // defects on the draft
  let scheduleItems = [];      // items for this schedule, grouped below

  let choosingUnit = false;

  // ── offline ──
  // The page runs the same UI either way; what changes is whether each tap
  // round-trips. Offline, everything is held locally and the whole check is
  // POSTed once, at completion, through the idempotent sync endpoint.
  let offlineMode = false;
  let cached = null;           // last saved offline bundle
  let clientUuid = null;
  let clientStartedAt = null;
  let pendingCount = 0;
  let failedEntries = [];
  let syncMsg = '';

  const LAST_UNIT_KEY = 'hg_last_inspected_unit';

  // The API client throws with `.status` on an HTTP response. No status at
  // all means the request never got an answer — that is the offline case,
  // and it is the only one we may quietly degrade for. A 500 is a bug, not
  // a yard with no bars, and should be shown.
  const isOffline = (e) => e?.status === undefined;

  onMount(() => {
    init();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onBackOnline);
      return () => window.removeEventListener('online', onBackOnline);
    }
  });

  async function init() {
    cached = await offlineStore.loadBundle();
    await refreshQueue();
    await load();
    // Refresh the cache once we know there's signal. This is what makes the
    // NEXT check possible with none — including the last signed report,
    // which is the document the driver is legally carrying.
    if (!offlineMode) {
      fleetApi.inspectionOfflineBundle()
        .then((b) => { cached = b; return offlineStore.saveBundle(b); })
        .catch(() => {});
      flushQueue();
    }
  }

  async function refreshQueue() {
    const q = await offlineStore.listQueued();
    pendingCount = q.filter((e) => e.status !== 'failed').length;
    failedEntries = q.filter((e) => e.status === 'failed');
  }

  function onBackOnline() { flushQueue(); }

  async function flushQueue() {
    const before = pendingCount;
    const r = await offlineStore.flushQueue((payload) => fleetApi.syncInspection(payload));
    await refreshQueue();
    if (r.synced > 0) {
      syncMsg = `${r.synced} check${r.synced === 1 ? '' : 's'} synced.`;
      setTimeout(() => (syncMsg = ''), 8000);
    } else if (before > 0 && r.failed > 0) {
      syncMsg = '';
    }
  }

  async function discardFailed(uuid) {
    await offlineStore.discardQueued(uuid);
    await refreshQueue();
  }

  // ── odometer ──
  let odometerKm = '';
  let odometerSource = 'manual';
  let odometerReadingAt = null;
  let odometerConfirmed = false;   // driver has accepted or typed a value
  let odometerTouched = false;     // driver edited the suggested value

  // ── location ──
  let locationText = '';
  let locationSource = 'manual';
  let locationLat = null;
  let locationLng = null;
  let gpsBusy = false;
  let gpsError = '';

  // ── towing ──
  let towingVehicleId = null;
  const LAST_TRAILER_KEY = 'hg_last_trailer';

  async function saveTowing() {
    // Remembered per driver: the same trailer usually goes back on the same
    // truck, and re-picking it every morning is how a field gets skipped.
    try {
      if (towingVehicleId) localStorage.setItem(LAST_TRAILER_KEY, String(towingVehicleId));
      else localStorage.removeItem(LAST_TRAILER_KEY);
    } catch { /* private mode */ }
    if (offlineMode || !inspection?.id) return;
    try {
      await fleetApi.saveInspection(inspection.id, { towing_vehicle_id: towingVehicleId });
    } catch (e) {
      if (!isOffline(e)) error = e.message;
    }
  }

  // ── groups ──
  let openGroups = new Set();
  let groupsAllOk = new Set();

  // ── completion ──
  let declarationAccepted = false;
  let completing = false;
  let completeError = '';
  let regressionPrompt = null;     // { previous_odometer_km, message }
  let result = null;               // completed inspection

  async function load(vehicleId = null) {
    loading = true; error = '';
    try {
      prefill = await fleetApi.inspectionPrefill(vehicleId);
      if (!prefill.vehicle) {
        scope = await fleetApi.inspectionScope();
        choosingUnit = true;
        loading = false;
        return;
      }
      await beginDraft(prefill.vehicle.id);
    } catch (e) {
      if (isOffline(e)) {
        await startOffline(vehicleId);
      } else {
        error = e.message;
      }
    } finally {
      loading = false;
    }
  }

  // ── Offline start ──────────────────────────────────────────────────
  // Everything here comes out of the cached bundle. If there is no bundle
  // the driver has never opened this page with signal, and there is nothing
  // honest to show them — a check run against a schedule we do not have is
  // not a check.
  async function startOffline(vehicleId = null) {
    offlineMode = true;
    if (!cached) {
      error = 'No signal, and this device has not cached the inspection schedule yet. '
            + 'Open this page once with a connection first.';
      return;
    }

    let unitId = vehicleId;
    if (!unitId) {
      try { unitId = Number(localStorage.getItem(LAST_UNIT_KEY)) || null; } catch { unitId = null; }
    }
    const unit = cached.units.find((u) => u.id === unitId);
    if (!unit) {
      scope = {
        units: cached.units.map((u) => ({
          ...u,
          has_valid_inspection: false,
          out_of_service: false,
        })),
      };
      choosingUnit = true;
      return;
    }

    const schedule = cached.schedules.find((s) => s.id === unit.inspection_schedule_id);
    if (!schedule) {
      error = 'The schedule for this unit is not cached on this device.';
      return;
    }

    clientUuid = offlineStore.newClientUuid();
    clientStartedAt = new Date().toISOString();
    scheduleItems = schedule.items || [];

    const lastReport = (cached.last_reports || []).find((r) => r.vehicle_id === unit.id) || null;

    // A local stand-in for the server draft row. Same field names so the
    // markup below does not have to know which mode it is in.
    inspection = {
      id: null,
      vehicle_id: unit.id,
      unit_number: unit.unit_number,
      plate: unit.license_plate,
      plate_jurisdiction: unit.plate_jurisdiction || 'ON',
      inspector_name: cached.inspector?.name || '',
      inspector_employee_id: cached.inspector?.employee_id ?? null,
      schedule_id: schedule.id,
      schedule_name: schedule.name,
      reg_reference: schedule.reg_reference,
      schedule_source_verified: schedule.source_verified,
    };

    // Carried-forward defects come from the cached open-defect list, and are
    // pinned exactly as they are online — a driver still cannot walk away
    // from one just because they are in a field.
    defects = (cached.open_defects || [])
      .filter((d) => d.vehicle_id === unit.id)
      .map((d) => ({
        id: `carried-${d.id}`,
        schedule_item_id: d.schedule_item_id,
        severity: d.severity,
        note: d.note,
        carried_from_id: d.id,
        group_name: d.group_name,
        item_label: d.item_label,
        minor_defect_text: d.minor_defect_text,
        major_defect_text: d.major_defect_text,
      }));

    prefill = {
      carrier_name: cached.carrier_name,
      inspector: cached.inspector,
      vehicle: {
        id: unit.id, unit_number: unit.unit_number, plate: unit.license_plate,
        plate_jurisdiction: unit.plate_jurisdiction,
      },
      schedule: {
        id: schedule.id, name: schedule.name, reg_reference: schedule.reg_reference,
        declaration_text: schedule.declaration_text, source_verified: schedule.source_verified,
      },
      // No telematics with no signal. The driver reads the dash, which is
      // what the regulation actually asks for anyway.
      odometer: null,
      telematics_available: false,
      previous_odometer_km: lastReport?.odometer_km ?? null,
      location: null,
      carried_forward_defects: defects,
      warnings: [],
      trailers: (cached.units || []).filter((u) => u.type === 'trailer'),
      default_location_text: cached.default_location_text || null,
    };
    odometerSource = 'manual';
    odometerConfirmed = false;
    choosingUnit = false;
    if (!locationText && cached.default_location_text) {
      locationText = cached.default_location_text;
      locationSource = 'manual';
    }
    try { towingVehicleId = Number(localStorage.getItem(LAST_TRAILER_KEY)) || null; } catch { towingVehicleId = null; }
  }

  async function beginDraft(vehicleId) {
    const started = await fleetApi.startInspection(vehicleId);
    inspection = started.inspection;
    defects = started.defects || [];
    choosingUnit = false;
    offlineMode = false;
    try { localStorage.setItem(LAST_UNIT_KEY, String(vehicleId)); } catch { /* private mode */ }

    // The report view is the canonical source for the schedule items, and it
    // returns them alongside the draft, so there's one shape to reason about.
    const full = await fleetApi.getInspection(inspection.id);
    scheduleItems = full.schedule_items || [];

    // Resume: a draft the driver already part-filled keeps its values.
    if (inspection.odometer_km != null) {
      odometerKm = String(inspection.odometer_km);
      odometerSource = inspection.odometer_source || 'manual';
      odometerConfirmed = true;
    } else if (prefill?.odometer) {
      odometerKm = String(prefill.odometer.suggested_km);
      odometerSource = 'telematics';
      odometerReadingAt = prefill.odometer.reading_at;
      // A fresh reading from a running truck can stand as-is. A stale one
      // has to be looked at.
      odometerConfirmed = prefill.odometer.auto_acceptable;
    }
    if (inspection.location_text) {
      locationText = inspection.location_text;
      locationSource = inspection.location_source || 'manual';
    } else if (prefill?.default_location_text) {
      // Most checks happen in the yard, so this saves typing the same
      // address daily. It is a suggestion, not an assertion — the driver
      // sees it in an editable field and the declaration they sign covers
      // its accuracy, so it is recorded as 'manual' like anything typed.
      locationText = prefill.default_location_text;
      locationSource = 'manual';
    }
    towingVehicleId = inspection.towing_vehicle_id ?? (() => {
      try { return Number(localStorage.getItem(LAST_TRAILER_KEY)) || null; } catch { return null; }
    })();
    if (towingVehicleId && !inspection.towing_vehicle_id) saveTowing();
    if (prefill?.location) {
      locationLat = prefill.location.lat;
      locationLng = prefill.location.lng;
      if (!locationText) locationSource = 'telematics';
    }
  }

  async function pickUnit(vehicleId) {
    loading = true; error = '';
    try {
      prefill = await fleetApi.inspectionPrefill(vehicleId);
      await beginDraft(vehicleId);
    } catch (e) {
      if (isOffline(e)) await startOffline(vehicleId);
      else error = e.message;
    } finally {
      loading = false;
    }
  }

  // ── grouping ──
  $: groups = (() => {
    const map = new Map();
    for (const it of scheduleItems) {
      if (!map.has(it.group_name)) map.set(it.group_name, []);
      map.get(it.group_name).push(it);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  })();

  // Reactive lookups keyed off `defects` so the class bindings below actually
  // update — a plain helper function called from the markup would not
  // re-run when the array is reassigned.
  $: defectByItem = new Map(defects.map((d) => [d.schedule_item_id, d]));
  $: carriedItemIds = new Set(defects.filter((d) => d.carried_from_id).map((d) => d.schedule_item_id));
  $: majorCount = defects.filter((d) => d.severity === 'major').length;
  $: minorCount = defects.filter((d) => d.severity === 'minor').length;
  $: outOfService = majorCount > 0;

  $: groupState = new Map(groups.map((g) => {
    const flagged = g.items.filter((i) => defectByItem.has(i.id));
    const worst = flagged.some((i) => defectByItem.get(i.id).severity === 'major')
      ? 'major'
      : (flagged.length ? 'minor' : (groupsAllOk.has(g.name) ? 'ok' : 'untouched'));
    return [g.name, { worst, flagged: flagged.length }];
  }));

  // Every group must be either marked OK or have something flagged, so a
  // driver cannot sign a report on a schedule they never scrolled through.
  $: unreviewedGroups = groups
    .filter((g) => groupState.get(g.name)?.worst === 'untouched')
    .map((g) => g.name);

  function toggleGroup(name) {
    const next = new Set(openGroups);
    next.has(name) ? next.delete(name) : next.add(name);
    openGroups = next;
  }

  function markGroupOk(name) {
    const next = new Set(groupsAllOk);
    next.add(name);
    groupsAllOk = next;
    const stillOpen = new Set(openGroups);
    stillOpen.delete(name);
    openGroups = stillOpen;
  }

  function unmarkGroupOk(name) {
    const next = new Set(groupsAllOk);
    next.delete(name);
    groupsAllOk = next;
  }

  // ── defects ──
  // Toggling a defect on or off. There is no severity argument: O. Reg.
  // 199/07 prints each defect under either the Minor or the Major column, so
  // which one it is was decided by the regulation. The driver's job is to say
  // whether the condition is present, not how bad it is.
  async function flag(item) {
    error = '';
    const existing = defectByItem.get(item.id);

    if (existing?.carried_from_id) {
      error = 'This defect carried forward from the last report. An admin closes it by recording the repair.';
      return;
    }

    if (offlineMode) {
      if (existing) {
        defects = defects.filter((d) => d.schedule_item_id !== item.id);
      } else {
        defects = [...defects, {
          id: `local-${item.id}`,
          schedule_item_id: item.id,
          severity: item.severity,
          note: null,
          carried_from_id: null,
          group_name: item.group_name,
          item_label: item.item_label,
          part_number: item.part_number,
          defect_letter: item.defect_letter,
          condition_note: item.condition_note,
          footnote_refs: item.footnote_refs,
        }];
      }
      unmarkGroupOk(item.group_name);
      return;
    }

    try {
      saving = true;
      if (existing) {
        const r = await fleetApi.clearDefect(inspection.id, existing.id);
        defects = r.defects;
      } else {
        const r = await fleetApi.flagDefect(inspection.id, { schedule_item_id: item.id });
        defects = r.defects;
      }
      unmarkGroupOk(item.group_name);
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
    }
  }

  async function saveNote(defect, note) {
    if (offlineMode) {
      defects = defects.map((d) => d.schedule_item_id === defect.schedule_item_id ? { ...d, note } : d);
      return;
    }
    try {
      const r = await fleetApi.updateDefect(inspection.id, defect.id, { note });
      defects = r.defects;
    } catch (e) { error = e.message; }
  }

  async function attachPhoto(defect, ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      saving = true;
      const r = await fleetApi.uploadDefectPhoto(inspection.id, defect.id, file);
      defects = r.defects;
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
      ev.target.value = '';
    }
  }

  // ── odometer / location ──
  function onOdometerInput() {
    odometerTouched = true;
    odometerConfirmed = true;
    // The driver changed the number, so it is no longer the telematics
    // reading — say so on the record.
    odometerSource = 'manual';
    odometerReadingAt = null;
  }

  function acceptSuggestedOdometer() {
    odometerConfirmed = true;
    if (!odometerTouched) odometerSource = 'telematics';
  }

  function useDeviceLocation() {
    gpsError = ''; gpsBusy = true;
    if (!navigator.geolocation) { gpsError = 'This device has no GPS.'; gpsBusy = false; return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locationLat = Number(pos.coords.latitude.toFixed(6));
        locationLng = Number(pos.coords.longitude.toFixed(6));
        locationSource = 'device_gps';
        gpsBusy = false;
      },
      (err) => { gpsError = err.message || 'Could not get a location.'; gpsBusy = false; },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // ── completion ──
  // Every reason the report cannot be signed yet, in the order they appear
  // on screen. A disabled button that does not say why is the fastest way to
  // make someone give up and go back to paper — which loses the record
  // entirely, the one outcome this whole feature exists to prevent.
  $: blockers = (() => {
    if (!inspection) return [];
    const out = [];
    if (String(odometerKm).trim() === '') {
      out.push({ text: 'Enter the odometer reading.', anchor: 'odo' });
    } else if (!odometerConfirmed) {
      out.push({
        text: 'Confirm the odometer — tap “That’s right”, or type the reading off the dash.',
        anchor: 'odo',
      });
    }
    if (locationText.trim() === '') {
      out.push({ text: 'Say where you are — the town or highway location.', anchor: 'loc' });
    }
    if (unreviewedGroups.length) {
      out.push({
        text: `Still to review: ${unreviewedGroups.join(', ')}.`,
        anchor: null,
      });
    }
    if (!declarationAccepted) {
      out.push({ text: 'Accept the declaration.', anchor: null });
    }
    return out;
  })();

  $: readyToSign = inspection && blockers.length === 0;

  function focusField(anchor) {
    if (!anchor) return;
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }

  // The payload the sync endpoint takes. Built here rather than in the
  // offline branch so the online path can reuse it verbatim when a submit
  // dies mid-flight — that case is the whole reason the queue exists.
  function syncPayload() {
    return {
      client_uuid: clientUuid || offlineStore.newClientUuid(),
      client_started_at: clientStartedAt,
      client_completed_at: new Date().toISOString(),
      vehicle_id: inspection.vehicle_id,
      towing_vehicle_id: towingVehicleId,
      declaration_accepted: true,
      no_defects: defects.length === 0,
      odometer_km: Number.parseInt(odometerKm, 10),
      odometer_source: odometerSource,
      odometer_reading_at: odometerReadingAt,
      location_text: locationText.trim(),
      location_source: locationSource,
      location_lat: locationLat,
      location_lng: locationLng,
      defects: defects.map((d) => ({
        schedule_item_id: d.schedule_item_id,
        severity: d.severity,
        note: d.note || null,
        carried_from_id: d.carried_from_id || null,
      })),
    };
  }

  // Stores the signed check on the device and reports it as done, because it
  // IS done — the driver performed and signed a real inspection at a real
  // time. Sync is delivery, not completion, and conflating the two is how a
  // completed check ends up lost.
  async function queueForSync() {
    const payload = syncPayload();
    clientUuid = payload.client_uuid;
    await offlineStore.queueInspection(payload);
    await refreshQueue();
    result = {
      queued: true,
      out_of_service: majorCount > 0,
      inspection: { ...inspection, completed_at: payload.client_completed_at },
      defects,
    };
    regressionPrompt = null;
    await tick();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // We might actually have signal — a failed submit is not proof of a dead
    // network. Try immediately, and fall back to the online listener.
    flushQueue();
  }

  async function complete(ackRegression = false) {
    completeError = ''; completing = true;

    if (offlineMode) {
      try {
        await queueForSync();
      } catch (e) {
        completeError = `Could not store the check on this device: ${e.message}`;
      } finally {
        completing = false;
      }
      return;
    }

    try {
      const payload = {
        declaration_accepted: true,
        no_defects: defects.length === 0,
        odometer_km: Number.parseInt(odometerKm, 10),
        odometer_source: odometerSource,
        odometer_reading_at: odometerReadingAt,
        location_text: locationText.trim(),
        location_source: locationSource,
        location_lat: locationLat,
        location_lng: locationLng,
      };
      if (ackRegression) payload.odometer_regression_ack = true;
      result = await fleetApi.completeInspection(inspection.id, payload);
      regressionPrompt = null;
      await tick();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      if (e.body?.code === 'odometer_regression') {
        regressionPrompt = e.body;
      } else if (isOffline(e)) {
        // Signal died between opening the check and signing it. The draft on
        // the server stays open and harmless; this queues the signed version
        // and the sync endpoint's client_uuid keeps it from doubling up.
        try {
          await queueForSync();
        } catch (qe) {
          completeError = `Lost connection, and the check could not be stored on this device: ${qe.message}`;
        }
      } else {
        completeError = e.message;
      }
    } finally {
      completing = false;
    }
  }

  function fmtAge(minutes) {
    if (minutes == null) return 'unknown age';
    if (minutes < 60) return `${minutes} min old`;
    const h = Math.floor(minutes / 60);
    return h < 24 ? `${h} h old` : `${Math.floor(h / 24)} d old`;
  }
</script>

<svelte:head><title>Circle check · Holm Graphics</title></svelte:head>

<div class="page">
  <!-- Queue status sits above everything, in every state. A signed check
       waiting to upload is the one thing on this page nobody should have to
       go looking for. -->
  {#if pendingCount > 0}
    <p class="alert pending">
      {pendingCount} completed check{pendingCount === 1 ? '' : 's'} saved on this device,
      waiting to upload.
      <button class="link-btn" on:click={flushQueue}>Try now</button>
    </p>
  {/if}
  {#if syncMsg}<p class="alert ok">{syncMsg}</p>{/if}
  {#each failedEntries as f (f.client_uuid)}
    <p class="alert error">
      <strong>A saved check was refused by the server.</strong> {f.error}
      <button class="link-btn" on:click={() => discardFailed(f.client_uuid)}>Discard it</button>
    </p>
  {/each}

  {#if loading}
    <p class="hint">Loading…</p>

  <!-- ═══ Completed ═══ -->
  {:else if result}
    {#if result.queued}
      <div class="queued">
        <div class="queued-tag">✓ Check complete — saved on this device</div>
        <p>
          {inspection.unit_number} · {inspection.plate}<br />
          Signed {new Date(result.inspection.completed_at).toLocaleString('en-CA')}.
        </p>
        <p class="fine">
          There was no connection, so the report is held here and will upload on its
          own when signal returns. The time above is the time you completed it — that
          is what goes on the record, not the upload time.
        </p>
      </div>
    {/if}
    {#if result.out_of_service}
      <div class="dno">
        <div class="dno-tag">DO NOT OPERATE</div>
        <p class="dno-lede">
          A major defect was recorded on {inspection.unit_number}. This unit is out of
          service and must not be driven.
        </p>
        <ul class="dno-list">
          {#each result.defects.filter((d) => d.severity === 'major') as d}
            <li><strong>{d.group_name} — {d.item_label}</strong><br />{d.major_defect_text}</li>
          {/each}
        </ul>
        <p class="dno-foot">
          The office has been notified. The unit returns to service once the repair is
          recorded against this report.
        </p>
      </div>
    {:else if !result.queued}
      <div class="done">
        <div class="done-tag">✓ Check complete</div>
        <p>
          {inspection.unit_number} · {result.inspection.plate}<br />
          Valid until {new Date(result.inspection.valid_until).toLocaleString('en-CA')}
        </p>
      </div>
    {/if}
    {#if result.inspection?.id}
      <a class="btn-primary" href={`/fleet/check/${result.inspection.id}`}>View the report</a>
    {/if}
    <a class="btn-plain" href="/fleet/check" on:click={() => { result = null; }}>Start another check</a>

  <!-- ═══ Unit picker ═══ -->
  {:else if choosingUnit}
    <h1>Which unit?</h1>
    {#if error}<p class="alert error">{error}</p>{/if}
    <ul class="unit-list">
      {#each (scope?.units || []).filter((u) => u.inspection_required) as u}
        <li>
          <button class="unit-row" on:click={() => pickUnit(u.id)}>
            <span class="unit">{u.unit_number}</span>
            <span class="meta">{[u.year, u.make, u.model].filter(Boolean).join(' ')} · <span class="plate">{u.license_plate}</span></span>
            {#if u.out_of_service}<span class="pill pill-major">Out of service</span>
            {:else if u.has_valid_inspection}<span class="pill pill-ok">Checked</span>
            {:else}<span class="pill pill-due">Due</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
    <details class="other-units">
      <summary>Other units (not required under O. Reg. 199/07)</summary>
      <ul class="unit-list">
        {#each (scope?.units || []).filter((u) => !u.inspection_required) as u}
          <li>
            <button class="unit-row" on:click={() => pickUnit(u.id)}>
              <span class="unit">{u.unit_number}</span>
              <span class="meta">{[u.year, u.make, u.model].filter(Boolean).join(' ')}</span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="fine">
        A check on one of these is kept as a voluntary record. Scope is set by the
        unit's registered gross weight, not by whether it tows.
      </p>
    </details>

  <!-- ═══ The check ═══ -->
  {:else if inspection}
    <header class="head">
      <div class="head-row">
        <h1>{inspection.unit_number}</h1>
        <a class="sched-link" href="/fleet/schedule-1">Schedule</a>
      </div>
      <div class="head-meta">
        <span class="plate">{inspection.plate} {inspection.plate_jurisdiction}</span>
        <span>{inspection.inspector_name}</span>
        <span>{new Date().toLocaleDateString('en-CA')}</span>
      </div>
    </header>

    {#if error}<p class="alert error">{error}</p>{/if}

    {#if offlineMode}
      <p class="alert offline">
        <strong>No connection.</strong> The check works normally and is saved on this
        device when you sign it, then uploads on its own. Photos and the telematics
        odometer are unavailable until signal returns.
      </p>
    {/if}

    {#if !inspection.schedule_source_verified}
      <p class="alert warn">
        <strong>Schedule not yet countersigned.</strong> The defect wording below was
        transcribed from Ontario e-Laws but has not been read back against the official
        source by whoever holds the CVOR file.
      </p>
    {/if}

    {#each (prefill?.warnings || []) as w}
      <p class="alert {w.severity === 'high' ? 'error' : 'warn'}">{w.message}</p>
    {/each}

    <!-- Carried-forward defects, pinned. The driver cannot clear these. -->
    {#if carriedItemIds.size > 0}
      <section class="carried">
        <h2>Carried forward — still open</h2>
        {#each defects.filter((d) => d.carried_from_id) as d}
          <div class="carried-item">
            <strong>{d.group_name} — {d.item_label}</strong>
            <span class="sev sev-{d.severity}">{d.severity}</span>
            {#if d.note}<p class="note">{d.note}</p>{/if}
          </div>
        {/each}
        <p class="fine">These stay on the report until an admin records the repair.</p>
      </section>
    {/if}

    <!-- ── Trailer ──
         Front and centre because the shop's practice is to run a check when
         pulling a trailer. Schedule 1 covers "trucks, tractors and
         trailers", so what's hitched is part of what was inspected. -->
    <section class="field">
      <label for="tow">Pulling a trailer?</label>
      <select id="tow" bind:value={towingVehicleId} on:change={saveTowing}>
        <option value={null}>No trailer</option>
        {#each (prefill?.trailers || []) as t}
          <option value={t.id}>{t.unit_number}{t.license_plate ? ` · ${t.license_plate}` : ''}</option>
        {/each}
      </select>
      {#if towingVehicleId}
        <p class="fine">The trailer is covered by the same schedule — inspect it too.</p>
      {/if}
    </section>

    <!-- ── Odometer ── -->
    <section class="field">
      <label for="odo">Odometer (km)</label>
      <div class="odo-row">
        <input id="odo" type="number" inputmode="numeric" bind:value={odometerKm}
               on:input={onOdometerInput} placeholder="Reading from the dash" />
        <span class="src src-{odometerSource}">{odometerSource}</span>
      </div>
      {#if prefill?.odometer && !odometerConfirmed}
        <div class="confirm">
          <p>
            Ford Pro reports <strong>{prefill.odometer.suggested_km} km</strong>
            ({fmtAge(prefill.odometer.age_minutes)}{prefill.odometer.ignition ? `, ignition ${prefill.odometer.ignition}` : ''}).
            Check it against the dash.
          </p>
          <button class="btn-small" on:click={acceptSuggestedOdometer}>That's right</button>
        </div>
      {:else if !prefill?.telematics_available}
        <p class="fine">Telematics is unavailable — read it off the dash.</p>
      {/if}
      {#if prefill?.previous_odometer_km != null}
        <p class="fine">Last report: {prefill.previous_odometer_km} km</p>
      {/if}
    </section>

    <!-- ── Location ── -->
    <section class="field">
      <label for="loc">Where are you?</label>
      <input id="loc" type="text" bind:value={locationText}
             on:input={() => { if (locationSource === 'telematics') locationSource = 'manual'; }}
             placeholder="Yard, customer site, address…" />
      <div class="loc-actions">
        <button class="btn-small" on:click={useDeviceLocation} disabled={gpsBusy}>
          {gpsBusy ? 'Locating…' : 'Use my GPS'}
        </button>
        {#if locationLat != null}
          <span class="fine">{locationLat.toFixed(4)}, {locationLng.toFixed(4)} · {locationSource}</span>
        {/if}
      </div>
      {#if gpsError}<p class="fine err">{gpsError}</p>{/if}
    </section>

    <!-- ── The schedule ── -->
    <section class="groups">
      <h2>Inspect {groups.length} groups</h2>
      {#each groups as g}
        {@const state = groupState.get(g.name) ?? { worst: 'untouched', flagged: 0 }}
        <div class="group group-{state.worst}">
          <div class="group-head">
            <button class="group-title" on:click={() => toggleGroup(g.name)}>
              <span class="chev">{openGroups.has(g.name) ? '▾' : '▸'}</span>
              {g.name}
              {#if state.flagged > 0}<span class="sev sev-{state.worst}">{state.flagged}</span>{/if}
            </button>
            {#if state.worst === 'untouched'}
              <button class="btn-ok" on:click={() => markGroupOk(g.name)}>All OK</button>
            {:else if state.worst === 'ok'}
              <span class="ok-tag">✓ OK</span>
            {/if}
          </div>

          {#if openGroups.has(g.name)}
            <!-- Each row IS a defect from the regulation, printed under
                 either the Minor or the Major column. Tap the ones present. -->
            <ul class="items">
              {#each g.items as item}
                {@const d = defectByItem.get(item.id)}
                {@const on = !!d}
                <li class="item" class:flagged={on}>
                  <button class="defect-row" class:on
                          disabled={saving || d?.carried_from_id}
                          on:click={() => flag(item)}>
                    <span class="tick" class:on>{on ? '✓' : ''}</span>
                    <span class="defect-body">
                      {#if item.condition_note}
                        <span class="cond">{item.condition_note}:</span>
                      {/if}
                      <span class="defect-text">{item.item_label}</span>
                      {#if item.footnote_refs?.length}
                        <sup class="fn">{item.footnote_refs.join(',')}</sup>
                      {/if}
                    </span>
                    <span class="sev sev-{item.severity}">{item.severity}</span>
                  </button>

                  {#if d}
                    <div class="defect-detail">
                      {#if d.carried_from_id}
                        <p class="carried-tag">Carried forward — only an admin can close this.</p>
                      {/if}
                      <input class="note-input" type="text" placeholder="Note (optional)"
                             value={d.note || ''} on:change={(e) => saveNote(d, e.currentTarget.value)} />
                      {#if offlineMode}
                        <span class="photo-off">Photos need a connection — describe it in the note.</span>
                      {:else}
                        <label class="photo-btn">
                          {d.photo_path ? 'Replace photo' : 'Add photo'}
                          <input type="file" accept="image/*" capture="environment"
                                 on:change={(e) => attachPhoto(d, e)} hidden />
                        </label>
                      {/if}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </section>

    <!-- ── Completion ── -->
    <section class="sign" class:sign-dno={outOfService}>
      {#if outOfService}
        <div class="dno-inline">
          <strong>DO NOT OPERATE.</strong>
          {majorCount} major {majorCount === 1 ? 'defect' : 'defects'} recorded. Submitting
          this report takes {inspection.unit_number} out of service — it must not be driven
          until the repair is recorded.
        </div>
      {:else if defects.length === 0}
        <p class="summary">No defects found. The report will state that explicitly.</p>
      {:else}
        <p class="summary">{minorCount} minor {minorCount === 1 ? 'defect' : 'defects'} recorded.</p>
      {/if}

      {#if blockers.length > 0}
        <div class="blockers">
          <strong>Before you can submit:</strong>
          <ul>
            {#each blockers as b}
              <li>
                {#if b.anchor}
                  <button class="jump" on:click={() => focusField(b.anchor)}>{b.text}</button>
                {:else}{b.text}{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <label class="declare">
        <input type="checkbox" bind:checked={declarationAccepted} />
        <span>{prefill?.schedule?.declaration_text || 'Loading the declaration…'}</span>
      </label>

      {#if regressionPrompt}
        <div class="alert warn">
          <p>{regressionPrompt.message}</p>
          <button class="btn-small" on:click={() => complete(true)} disabled={completing}>
            The reading is correct — record it anyway
          </button>
        </div>
      {/if}
      {#if completeError}<p class="alert error">{completeError}</p>{/if}

      <button class="btn-primary" class:danger={outOfService}
              disabled={!readyToSign || completing}
              on:click={() => complete(false)}>
        {completing ? 'Submitting…' : (outOfService ? 'Submit — unit out of service' : 'Submit and go')}
      </button>
    </section>
  {:else if error}
    <p class="alert error">{error}</p>
  {/if}
</div>

<style>
  .page { max-width: 36rem; margin: 0 auto; padding: 0.85rem 0.85rem 4rem; }
  h1 { margin: 0; font-size: 1.35rem; font-weight: 700; }
  h2 { font-size: 0.95rem; color: #555; margin: 1.4rem 0 0.5rem; font-weight: 600; }
  .hint { color: #666; text-align: center; padding: 2rem 1rem; }
  .fine { color: #777; font-size: 0.82rem; margin: 0.35rem 0 0; }
  .fine.err { color: #b00; }
  .plate { font-family: ui-monospace, monospace; }

  .head { position: sticky; top: 0; background: #fafafa; padding: 0.5rem 0 0.7rem; z-index: 5; border-bottom: 1px solid #eee; }
  .head-row { display: flex; align-items: baseline; justify-content: space-between; }
  .head-meta { display: flex; gap: 0.7rem; color: #666; font-size: 0.85rem; flex-wrap: wrap; margin-top: 0.2rem; }
  .sched-link { color: #c01818; font-size: 0.85rem; font-weight: 600; text-decoration: none; border: 1px solid #c01818; border-radius: 999px; padding: 0.2rem 0.6rem; }

  .alert { padding: 0.7rem 0.85rem; border-radius: 0.4rem; margin: 0.6rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #a10000; }
  .alert.warn  { background: #fdf5d3; color: #6c5300; }
  .alert.ok      { background: #e8f6ec; color: #1f6b34; }
  .alert.pending { background: #eef2f7; color: #45607d; }
  .alert.offline { background: #eef2f7; color: #45607d; }
  .link-btn { background: none; border: none; padding: 0; font: inherit; font-weight: 600;
              color: inherit; text-decoration: underline; cursor: pointer; }
  .photo-off { display: inline-block; margin-top: 0.4rem; font-size: 0.8rem; color: #888; }
  .queued { border: 1px solid #a8c0d8; background: #f4f8fc; border-radius: 0.6rem;
            padding: 1.1rem; margin-bottom: 1rem; }
  .queued-tag { font-size: 1.1rem; font-weight: 700; color: #2c5a86; margin-bottom: 0.4rem; }
  .queued p { margin: 0 0 0.5rem; }

  /* Unit picker */
  .unit-list { list-style: none; padding: 0; margin: 0.5rem 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .unit-row { display: flex; align-items: center; gap: 0.7rem; width: 100%; min-height: 64px; padding: 0.65rem 0.85rem;
              background: white; border: 1px solid #e4e4e7; border-radius: 0.55rem; text-align: left; font: inherit; cursor: pointer; }
  .unit-row .unit { font-size: 1.2rem; font-weight: 700; }
  .unit-row .meta { color: #666; font-size: 0.85rem; flex-grow: 1; }
  .other-units { margin-top: 1.5rem; }
  .other-units summary { color: #666; font-size: 0.9rem; cursor: pointer; }
  .pill { font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.55rem; border-radius: 999px; white-space: nowrap; }
  .pill-ok    { background: #e8f6ec; color: #1f6b34; }
  .pill-due   { background: #fdf5d3; color: #6c5300; }
  .pill-major { background: #fee; color: #a10000; }

  /* Carried forward */
  .carried { border: 1px solid #f0c000; background: #fffdf3; border-radius: 0.5rem; padding: 0.75rem 0.85rem; margin: 0.8rem 0; }
  .carried h2 { margin: 0 0 0.5rem; color: #6c5300; }
  .carried-item { padding: 0.4rem 0; border-top: 1px solid #f3e5b0; }
  .carried-item:first-of-type { border-top: none; }
  .carried-item .note { color: #666; font-size: 0.85rem; margin: 0.2rem 0 0; }

  /* Fields */
  .field { margin: 1.1rem 0; }
  .field label { display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.35rem; }
  .field input[type="text"], .field input[type="number"] {
    width: 100%; padding: 0.85rem 0.9rem; font-size: 1.1rem; border: 1px solid #c4c4c8;
    border-radius: 0.5rem; box-sizing: border-box; background: white;
  }
  .field input:focus { outline: 2px solid #c01818; outline-offset: 1px; border-color: transparent; }
  .odo-row { display: flex; align-items: center; gap: 0.5rem; }
  .odo-row input { flex-grow: 1; }
  .src { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; padding: 0.25rem 0.5rem; border-radius: 0.3rem; }
  .src-telematics { background: #e8f0fb; color: #1c4e8a; }
  .src-manual     { background: #f0f0f0; color: #666; }
  .confirm { background: #f6f8fb; border: 1px solid #d8e2f0; border-radius: 0.45rem; padding: 0.6rem 0.75rem; margin-top: 0.5rem; }
  .confirm p { margin: 0 0 0.5rem; font-size: 0.88rem; }
  .loc-actions { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.5rem; flex-wrap: wrap; }

  /* Groups */
  .group { border: 1px solid #e4e4e7; border-radius: 0.5rem; background: white; margin-bottom: 0.45rem; overflow: hidden; }
  .group-ok    { border-color: #bfe3ca; background: #f7fcf8; }
  .group-minor { border-color: #f0c000; }
  .group-major { border-color: #d33; background: #fffafa; }
  .group-head { display: flex; align-items: stretch; }
  .group-title { flex-grow: 1; display: flex; align-items: center; gap: 0.5rem; padding: 0.85rem;
                 background: none; border: none; font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
  .chev { color: #999; width: 0.9rem; }
  .btn-ok { padding: 0 1rem; background: #f4f6f4; border: none; border-left: 1px solid #e4e4e7;
            font: inherit; font-weight: 600; color: #1f6b34; cursor: pointer; white-space: nowrap; }
  .btn-ok:active { background: #e8f6ec; }
  .ok-tag { display: flex; align-items: center; padding: 0 1rem; color: #1f6b34; font-weight: 600; font-size: 0.9rem; }

  .items { list-style: none; margin: 0; padding: 0; border-top: 1px solid #eee; }
  .item { padding: 0.6rem 0.85rem; border-bottom: 1px solid #f2f2f2; }
  .item:last-child { border-bottom: none; }
  .item-label { font-size: 0.95rem; margin-bottom: 0.4rem; }
  .sev-buttons { display: flex; gap: 0.4rem; align-items: center; }
  .defect-row { display: flex; align-items: flex-start; gap: 0.6rem; width: 100%;
                background: none; border: none; padding: 0.15rem 0; font: inherit;
                text-align: left; cursor: pointer; }
  .defect-row:disabled { opacity: 0.6; cursor: default; }
  .tick { flex-shrink: 0; width: 1.5rem; height: 1.5rem; border: 2px solid #c4c4c8;
          border-radius: 0.3rem; display: flex; align-items: center; justify-content: center;
          font-weight: 800; color: white; font-size: 0.95rem; margin-top: 0.05rem; }
  .tick.on { background: #a10000; border-color: #a10000; }
  .defect-body { flex-grow: 1; font-size: 0.9rem; line-height: 1.4; color: #333; }
  .cond { display: block; font-size: 0.78rem; font-weight: 700; color: #777;
          text-transform: uppercase; letter-spacing: 0.02em; }
  .fn { font-size: 0.65rem; color: #1c4e8a; font-weight: 700; }
  .item.flagged { background: #fffafa; }
  .carried-tag { margin: 0 0 0.35rem; font-size: 0.8rem; color: #6c5300; font-weight: 600; }
  .field select { width: 100%; padding: 0.85rem 0.9rem; font-size: 1.05rem;
                  border: 1px solid #c4c4c8; border-radius: 0.5rem; background: white;
                  box-sizing: border-box; }

  .defect-detail { margin-top: 0.5rem; padding-left: 0.6rem; border-left: 3px solid #eee; }
  .reg-text { font-size: 0.85rem; color: #555; margin: 0 0 0.4rem; }
  .note-input { width: 100%; padding: 0.5rem 0.6rem; font-size: 0.9rem; border: 1px solid #d4d4d8;
                border-radius: 0.35rem; box-sizing: border-box; }
  .photo-btn { display: inline-block; margin-top: 0.4rem; font-size: 0.85rem; font-weight: 600;
               color: #1c4e8a; cursor: pointer; }

  .sev { font-size: 0.72rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 999px; }
  .sev-minor { background: #fdf5d3; color: #6c5300; }
  .sev-major { background: #fee; color: #a10000; }

  /* Signing */
  .sign { margin-top: 1.6rem; padding: 1rem; border: 1px solid #e4e4e7; border-radius: 0.6rem; background: white; }
  .sign-dno { border-color: #d33; background: #fffafa; }
  .summary { margin: 0 0 0.8rem; font-weight: 600; }
  .dno-inline { background: #fee; color: #a10000; padding: 0.75rem 0.85rem; border-radius: 0.4rem;
                margin-bottom: 0.8rem; font-size: 0.92rem; line-height: 1.45; }
  .declare { display: flex; gap: 0.65rem; align-items: flex-start; margin: 0.9rem 0; font-size: 0.85rem; color: #444; line-height: 1.45; }
  .declare input { margin-top: 0.2rem; width: 1.15rem; height: 1.15rem; flex-shrink: 0; }

  .blockers { background: #fffdf3; border: 1px solid #e0b400; border-radius: 0.45rem;
              padding: 0.7rem 0.85rem; margin: 0.8rem 0; font-size: 0.88rem; color: #6c5300; }
  .blockers ul { margin: 0.4rem 0 0; padding-left: 1.1rem; }
  .blockers li { margin-bottom: 0.25rem; }
  .jump { background: none; border: none; padding: 0; font: inherit; color: #6c5300;
          text-decoration: underline; text-align: left; cursor: pointer; }

  .btn-primary { display: block; width: 100%; padding: 1rem; margin-top: 0.6rem; font-size: 1.05rem; font-weight: 700;
                 color: white; background: #1f6b34; border: none; border-radius: 0.5rem; cursor: pointer;
                 text-align: center; text-decoration: none; box-sizing: border-box; }
  .btn-primary.danger { background: #a10000; }
  .btn-primary:disabled { background: #c9c9c9; cursor: default; }
  .btn-plain { display: block; text-align: center; margin-top: 0.7rem; color: #666; font-size: 0.9rem; }
  .btn-small { padding: 0.5rem 0.9rem; font: inherit; font-size: 0.85rem; font-weight: 600;
               border: 1px solid #c4c4c8; border-radius: 0.4rem; background: white; cursor: pointer; }

  /* Result */
  .dno { border: 2px solid #a10000; border-radius: 0.6rem; padding: 1.1rem; background: #fff5f5; margin-bottom: 1rem; }
  .dno-tag { font-size: 1.35rem; font-weight: 800; color: #a10000; letter-spacing: 0.04em; margin-bottom: 0.5rem; }
  .dno-lede { margin: 0 0 0.8rem; font-weight: 600; }
  .dno-list { margin: 0 0 0.8rem; padding-left: 1.1rem; font-size: 0.9rem; line-height: 1.5; }
  .dno-foot { margin: 0; font-size: 0.85rem; color: #666; }
  .done { border: 1px solid #bfe3ca; background: #f7fcf8; border-radius: 0.6rem; padding: 1.1rem; margin-bottom: 1rem; }
  .done-tag { font-size: 1.15rem; font-weight: 700; color: #1f6b34; margin-bottom: 0.4rem; }
</style>
