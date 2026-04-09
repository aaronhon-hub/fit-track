// TodayPage.tsx
// Primary page — shows today's planned session, readiness check-in, and session launcher.
// Will be wired to sessionPlanRepo, sessionLogRepo, and the session machine in P3 Sprint 1.

export default function TodayPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Today</h1>
      </div>
      <div className="empty-state">
        <span className="empty-state-label">Session engine connecting</span>
      </div>
    </div>
  );
}
