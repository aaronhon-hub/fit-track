// SettingsPage.tsx
import { useState } from 'react';

export default function SettingsPage() {
  const [token, setToken] = useState(() => localStorage.getItem('fit_tracker_token') ?? '');
  const [saved, setSaved] = useState(false);

  function handleSave() {
    localStorage.setItem('fit_tracker_token', token.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="card" style={{ marginBottom: 'var(--sp-4)' }}>
        <h2 className="display-label" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--sp-4)' }}>
          Sync Configuration
        </h2>
        <label style={{ display: 'block', marginBottom: 'var(--sp-2)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Server auth token
        </label>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="Bearer token from config.json"
          style={{
            width: '100%',
            background: 'var(--bg-base)',
            border: '1px solid var(--bg-border)',
            borderRadius: '6px',
            padding: 'var(--sp-3)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.875rem',
            marginBottom: 'var(--sp-4)',
          }}
        />
        <button className="btn btn--primary btn--full" onClick={handleSave}>
          {saved ? 'Saved' : 'Save Token'}
        </button>
      </div>

      <div className="card">
        <h2 className="display-label" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 'var(--sp-4)' }}>
          About
        </h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Adaptive Fitness Coach v0.1.0
        </p>
      </div>
    </div>
  );
}
