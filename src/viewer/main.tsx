import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { AppBrand } from '@/components/AppBrand';
import '../styles.css';
import '../viewer.css';

const OptimizationView = lazy(() => import('../optimization/OptimizationView'));
function ViewerApp() {
  return <div className="viewer-app">
    <header className="header viewer-header"><AppBrand subtitle="Оптимизация прикреплений" /><span className="opt-header-label">Оптимизация прикреплений</span></header>
    <main><Suspense fallback={<p role="status">Загрузка оптимизации…</p>}><OptimizationView active /></Suspense></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><ViewerApp /></StrictMode>);
