// OnboardingPage.tsx
// Stub — will be wired to onboardingMachine (src/onboarding/) in P3 Sprint 1.
// The machine and all state types are already implemented and tested (Sprint 3-4).

export default function OnboardingPage() {
  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 className="display-label" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--sp-6)' }}>
          Adaptive Fitness Coach
        </h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
          Onboarding UI — connecting in P3 Sprint 1
        </p>
      </div>
    </div>
  );
}
