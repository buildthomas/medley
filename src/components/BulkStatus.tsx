import { useState } from 'react';
import { cancelBulk, dismissBulk, runBulk, useBulkJob } from '../lib/bulk';

/** Progress for the background import, shown under the top bar on every tab. */
export function BulkStatus() {
  const job = useBulkJob();
  const [showFailed, setShowFailed] = useState(false);
  if (!job) return null;
  const pct = job.total ? Math.round((100 * job.done) / job.total) : 100;

  return (
    <div className="bulk-status">
      <div className="bulk-line">
        {job.running ? <span className="spinner" /> : <span className="ok">✓</span>}
        <span className="truncate">
          <b>{job.running ? 'Importing' : 'Import finished'}</b> · {job.label}
        </span>
        <span className="muted tabular">
          {job.done}/{job.total} · {job.added} added · {job.skipped} already had · {job.failed.length} not found
        </span>
        <span className="spacer" />
        {job.failed.length > 0 && (
          <button className="link" onClick={() => setShowFailed(!showFailed)}>
            {showFailed ? 'hide' : 'show'} not found
          </button>
        )}
        {!job.running && job.failed.length > 0 && (
          <button className="link" onClick={() => runBulk('retry', job.failed.map((f) => f.game))}>
            retry those
          </button>
        )}
        {job.running ? (
          <button className="link" onClick={cancelBulk}>
            stop
          </button>
        ) : (
          <button className="link" onClick={dismissBulk}>
            dismiss
          </button>
        )}
      </div>
      {job.running && (
        <div className="bar">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
      {showFailed && (
        <p className="small muted">
          {job.failed.map((f) => f.game.title).join(' · ')}. These can be added by hand under <b>Add link</b>.
        </p>
      )}
    </div>
  );
}
