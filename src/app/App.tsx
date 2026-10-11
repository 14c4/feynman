import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { SessionProvider } from '../state/SessionProvider';
import { AuthProvider } from '../state/AuthProvider';
import { AccountPage } from '../features/account/AccountPage';
import { MonitoringProvider } from '../features/insights/MonitoringProvider';
import { AppLayout } from '../components/AppLayout';
import { EmptyState } from '../components/EmptyState';
import { HomePage } from '../features/topics/HomePage';
import { StudyPage } from '../features/study/StudyPage';
import { ResultsPage } from '../features/feedback/ResultsPage';

function Providers() {
  return <SessionProvider><AuthProvider><MonitoringProvider><Outlet /></MonitoringProvider></AuthProvider></SessionProvider>;
}

// A small data router keeps the route tree simple; no loaders or actions.
const router = createBrowserRouter([{
  element: <Providers />,
  children: [{
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/account', element: <AccountPage /> },
      { path: '/study/:sessionId', element: <StudyPage /> },
      { path: '/results/:sessionId', element: <ResultsPage /> },
      { path: '*', element: <EmptyState title="This page wandered off." description="Choose a topic to get back to learning." /> },
    ],
  }],
}]);

export function App() {
  return <RouterProvider router={router} />;
}
