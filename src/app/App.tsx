import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { SessionProvider } from '../state/SessionProvider';
import { AppLayout } from '../components/AppLayout';
import { EmptyState } from '../components/EmptyState';
import { HomePage } from '../features/topics/HomePage';
import { StudyPage } from '../features/study/StudyPage';
import { ResultsPage } from '../features/feedback/ResultsPage';

function Providers() {
  return <SessionProvider><Outlet /></SessionProvider>;
}

// A small data router enables unsaved-draft blocking; no loaders or actions.
const router = createBrowserRouter([{
  path: '/preview/:screen?',
  lazy: async () => {
    const { PreviewApp } = await import('../features/preview/PreviewApp');
    return { Component: PreviewApp };
  },
}, {
  element: <Providers />,
  children: [{
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/study/:sessionId', element: <StudyPage /> },
      { path: '/results/:sessionId', element: <ResultsPage /> },
      { path: '*', element: <EmptyState title="This page wandered off." description="Choose a topic to get back to learning." /> },
    ],
  }],
}]);

export function App() {
  return <RouterProvider router={router} />;
}
