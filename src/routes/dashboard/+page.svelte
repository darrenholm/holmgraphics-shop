{/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page { padding: 28px 32px; min-height: 100vh; }

  .top-bar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 24px; gap: 16px; flex-wrap: wrap;
  }
  .top-bar-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .top-bar-right { display: flex; align-items: center; gap: 10px; }

  .page-title {
    font-family: var(--font-display); font-size: 1.8rem; font-weight: 900;
    letter-spacing: 0.04em; text-transform: uppercase; color: var(--text);
  }

  .overdue-pill {
    background: rgba(192,57,43,0.15); border: 1px solid rgba(192,57,43,0.4);
    color: #dc2626; font-family: var(--font-display); font-size: 0.78rem;
    font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 4px 10px; border-radius: 20px;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }

  .toggle-group {
    display: flex; background: var(--surface-2);
    border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;
  }
  .toggle-btn {
    padding: 7px 16px; background: none; border: none; cursor: pointer;
    font-family: var(--font-display); font-size: 0.85rem; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--text-muted); transition: all 0.15s;
  }
  .toggle-btn.active { background: var(--red); color: #fff; }

  .search-wrap { position: relative; }
  .search-icon {
    position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
    color: var(--text-dim); pointer-events: none;
  }
  .search-input {
    width: 220px; padding: 8px 12px 8px 32px;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius); color: var(--text); font-size: 0.88rem;
  }
  .search-input-lg { width: 300px; }

  .board {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 16px; align-items: start;
  }

  .column {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); overflow: hidden;
  }
  .column-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .col-count {
    font-family: var(--font-display); font-size: 0.85rem;
    color: var(--text-muted); font-weight: 700;
  }

  .job-list {
    padding: 10px; display: flex; flex-direction: column;
    gap: 8px; min-height: 60px;
  }

  .job-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 12px 14px;
    cursor: pointer; text-align: left; width: 100%;
    transition: all 0.15s; display: flex; flex-direction: column;
    gap: 4px; position: relative; overflow: hidden;
  }
  .job-card::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0;
    width: 3px; background: var(--border-mid); transition: background 0.15s;
  }
  .job-card:hover { border-color: var(--red); transform: translateY(-1px); box-shadow: var(--shadow); }
  .job-card:hover::before { background: var(--red); }
  .job-card.is-overdue { border-color: rgba(192,57,43,0.4); }
  .job-card.is-overdue::before { background: var(--red); }

  .job-card-top { display: flex; justify-content: space-between; align-items: center; }
  .job-id { font-family: var(--font-display); font-size: 0.72rem; color: var(--text-dim); letter-spacing: 0.05em; }
  .job-name { font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; color: var(--text); line-height: 1.2; }
  .job-client { font-size: 0.8rem; color: var(--text-muted); }

  .job-footer {
    display: flex; justify-content: space-between; align-items: center; margin-top: 2px;
  }
  .job-type { font-size: 0.72rem; color: var(--text-dim); font-style: italic; }
  .job-assigned { font-size: 0.72rem; color: var(--text-muted); }
  .job-due { font-family: var(--font-display); font-size: 0.72rem; color: var(--text-dim); }
  .job-due.due-hot { color: #dc2626; font-weight: 700; }

  .empty-col {
    text-align: center; padding: 24px 0;
    color: var(--text-dim); font-size: 0.82rem; font-style: italic;
  }

  /* Client Search Section */
  .client-search-section {
    margin-top: 40px; padding-top: 32px;
    border-top: 2px solid var(--border);
  }
  .client-search-title {
    font-family: var(--font-display); font-size: 0.85rem; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted);
    margin-bottom: 14px;
  }
  .client-search-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }

  .results-count {
    font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;
    font-family: var(--font-display); letter-spacing: 0.04em;
  }
  .results-table { width: 100%; border-collapse: collapse; }
  .results-table th {
    text-align: left; padding: 8px 12px;
    font-family: var(--font-display); font-size: 0.75rem;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-muted); border-bottom: 2px solid var(--border);
    background: var(--surface-2);
  }
  .results-table td {
    padding: 10px 12px; border-bottom: 1px solid var(--border);
    font-size: 0.9rem; color: var(--text);
  }
  .result-row { cursor: pointer; transition: background 0.12s; }
  .result-row:hover td { background: var(--surface-2); }
  .job-id-cell { font-family: var(--font-display); font-size: 0.8rem; color: var(--text-dim); }
  .job-name-cell { font-weight: 600; }
  .text-muted { color: var(--text-muted) !important; }
  .due-hot { color: #dc2626 !important; font-weight: 600; }
  .empty-msg { color: var(--text-dim); font-style: italic; padding: 16px 0; }

  .loading-state, .error-state {
    display: flex; align-items: center; gap: 12px;
    padding: 48px; color: var(--text-muted); font-size: 0.9rem;
  }
  .loading-spinner {
    width: 20px; height: 20px; border: 2px solid var(--border);
    border-top-color: var(--red); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 900px) { .board { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) {
    .page { padding: 16px; }
    .board { grid-template-columns: 1fr; }
    .search-input { width: 160px; }
    .search-input-lg { width: 200px; }
  }
</style>
