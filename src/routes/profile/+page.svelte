<!-- src/routes/profile/+page.svelte -->
<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  let current_password = '';
  let new_password = '';
  let confirm_password = '';
  let saving = false;
  let success = '';
  let error = '';

  onMount(() => {
    if (!$auth) goto('/login');
  });

  async function changePassword() {
    error = ''; success = '';
    if (!current_password || !new_password || !confirm_password) {
      error = 'All fields are required'; return;
    }
    if (new_password !== confirm_password) {
      error = 'New passwords do not match'; return;
    }
    if (new_password.length < 6) {
      error = 'New password must be at least 6 characters'; return;
    }
    saving = true;
    try {
      await api.changePassword(current_password, new_password);
      success = 'Password changed successfully!';
      current_password = ''; new_password = ''; confirm_password = '';
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Profile — Holm Graphics</title></svelte:head>

<div class="page">
  <a href="/dashboard" class="back-link">← Job Board</a>
  <h1 class="page-title">My Profile</h1>

  {#if $auth}
    <div class="profile-card card">
      <div class="user-row">
        <div class="avatar">{$auth.name?.[0]?.toUpperCase() || '?'}</div>
        <div>
          <div class="user-name">{$auth.name}</div>
          <div class="user-email">{$auth.email}</div>
          <div class="user-role">{$auth.role}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 class="section-title">Change Password</h2>

      {#if success}
        <div class="alert alert-success">{success}</div>
      {/if}
      {#if error}
        <div class="alert alert-error">{error}</div>
      {/if}

      <div class="form-group">
        <label for="current">Current Password</label>
        <input id="current" type="password" bind:value={current_password} placeholder="Enter current password" />
      </div>
      <div class="form-group">
        <label for="new">New Password</label>
        <input id="new" type="password" bind:value={new_password} placeholder="At least 6 characters" />
      </div>
      <div class="form-group">
        <label for="confirm">Confirm New Password</label>
        <input id="confirm" type="password" bind:value={confirm_password} placeholder="Repeat new password" />
      </div>

      <button class="btn btn-primary" on:click={changePassword} disabled={saving}>
        {saving ? 'Saving…' : 'Change Password'}
      </button>
    </div>
  {/if}
</div>

<style>
  .page { padding: 28px 32px; max-width: 500px; }

  .back-link {
    font-family: var(--font-display); font-size: 0.8rem;
    letter-spacing: 0.06em; color: var(--text-muted);
    text-transform: uppercase; display: inline-block; margin-bottom: 12px;
  }
  .back-link:hover { color: var(--red); }

  .page-title {
    font-family: var(--font-display); font-size: 2rem; font-weight: 900;
    letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--text); margin-bottom: 24px;
  }

  .profile-card { margin-bottom: 16px; }
  .user-row { display: flex; align-items: center; gap: 16px; }
  .avatar {
    width: 48px; height: 48px; background: var(--red);
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display); font-weight: 900; font-size: 1.2rem;
    color: #fff; flex-shrink: 0;
  }
  .user-name { font-family: var(--font-display); font-weight: 700; font-size: 1.1rem; color: var(--text); }
  .user-email { font-size: 0.88rem; color: var(--text-muted); margin-top: 2px; }
  .user-role { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }

  .section-title {
    font-family: var(--font-display); font-size: 0.78rem; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted);
    margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--border);
  }

  .alert {
    padding: 10px 14px; border-radius: var(--radius);
    font-size: 0.9rem; margin-bottom: 16px;
  }
  .alert-success { background: rgba(39,174,96,0.12); color: #27ae60; border: 1px solid rgba(39,174,96,0.3); }
  .alert-error { background: rgba(220,38,38,0.1); color: #dc2626; border: 1px solid rgba(220,38,38,0.2); }

  @media (max-width: 768px) { .page { padding: 16px; } }
</style>