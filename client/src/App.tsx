import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import BottomNav from './components/BottomNav';
import TodayPage from './pages/TodayPage';
import HistoryPage from './pages/HistoryPage';
import ProgressPage from './pages/ProgressPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingPage from './pages/OnboardingPage';

// The router basename must match the Vite base and Express static mount path.
// All routes are relative to /fit-tracker/.
const BASENAME = '/fit-tracker';

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <div className="app-shell">
        <main className="app-main">
          <Routes>
            {/* Default: redirect / → /today */}
            <Route path="/" element={<Navigate to="/today" replace />} />

            {/* Core navigation pages */}
            <Route path="/today"    element={<TodayPage />} />
            <Route path="/history"  element={<HistoryPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/settings" element={<SettingsPage />} />

            {/* Onboarding — shown on first install before profile exists */}
            <Route path="/onboarding/*" element={<OnboardingPage />} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </main>

        {/* Bottom nav is hidden on onboarding route */}
        <BottomNav />
      </div>
    </BrowserRouter>
  );
}
