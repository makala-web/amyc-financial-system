'use client';

import { useEffect, useRef } from 'react';
import {
  SidebarProvider,
  SidebarInset,
} from '@/components/ui/sidebar';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import { useAuthStore, useUIStore } from '@/lib/store';
import { startAutoBackup } from '@/lib/backup';
import { initializeOfflineRuntime } from '@/lib/offline-startup';
import { isNativeApp } from '@/lib/native-files';
import SyncBootstrap from '@/components/pwa/SyncBootstrap';

// Real section components
import Dashboard from '@/components/dashboard/Dashboard';
import OrganizationManager from '@/components/organization/OrganizationManager';
import ReportsEngine from '@/components/reports/ReportsEngine';
import IncomePage from '@/components/transactions/IncomePage';
import ExpensePage from '@/components/transactions/ExpensePage';
import BudgetPage from '@/components/budget/BudgetPage';
import ExcelManager from '@/components/excel/ExcelManager';
import NotesManager from '@/components/notes/NotesManager';
import SettingsPage from '@/components/settings/SettingsPage';
import PerformanceReportPage from '@/components/reports/PerformanceReportPage';
import UserGuidePage from '@/components/guide/UserGuidePage';
import { APP_VERSION } from '@/lib/app-version';
import AMYCLogo from '@/components/brand/AMYCLogo';

const SECTION_MAP: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  income: IncomePage,
  expense: ExpensePage,
  budget: BudgetPage,
  reports: ReportsEngine,
  performance: PerformanceReportPage,
  organization: OrganizationManager,
  excel: ExcelManager,
  notes: NotesManager,
  guide: UserGuidePage,
  settings: SettingsPage,
};

export default function MainLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const activeSection = useUIStore((s) => s.activeSection);
  const mainRef = useRef<HTMLElement>(null);
  const lastHistorySection = useRef<string | null>(null);
  const skipNextHistoryPush = useRef(false);

  // Initialize the database on mount
  useEffect(() => {
    initializeOfflineRuntime().catch(console.error);
    if (!isNativeApp()) {
      startAutoBackup();
    }
  }, []);

  // Scroll to top when section changes (menu navigation auto-scroll)
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeSection]);

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return;

    window.history.replaceState({ amycSection: activeSection }, '', window.location.href);
    lastHistorySection.current = activeSection;

    const onPopState = (event: PopStateEvent) => {
      const section = event.state?.amycSection;
      if (typeof section === 'string' && SECTION_MAP[section]) {
        skipNextHistoryPush.current = true;
        useUIStore.getState().setActiveSection(section);
        return;
      }

      if (useUIStore.getState().activeSection !== 'dashboard') {
        skipNextHistoryPush.current = true;
        useUIStore.getState().setActiveSection('dashboard');
        window.history.replaceState({ amycSection: 'dashboard' }, '', window.location.href);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return;
    if (skipNextHistoryPush.current) {
      skipNextHistoryPush.current = false;
      lastHistorySection.current = activeSection;
      return;
    }
    if (lastHistorySection.current === activeSection) return;

    window.history.pushState({ amycSection: activeSection }, '', window.location.href);
    lastHistorySection.current = activeSection;
  }, [activeSection, isAuthenticated]);

  if (!isAuthenticated) {
    return null;
  }

  const ActiveSectionComponent = SECTION_MAP[activeSection] || Dashboard;

  return (
    <>
    <SyncBootstrap />
    <SidebarProvider
      defaultOpen={true}
      style={{
        '--sidebar-width': '16rem',
      } as React.CSSProperties}
    >
      <AppSidebar />

      <SidebarInset className="flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <AppHeader />

        {/* Main Content - scrollable area */}
        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 bg-gradient-to-br from-emerald-50/30 via-white to-emerald-50/20"
        >
          <div className="min-w-0 w-full">
            <ActiveSectionComponent />
          </div>
        </main>

        {/* Professional Sticky Footer */}
        <footer className="shrink-0 border-t border-emerald-100 bg-white/95 backdrop-blur-sm py-2 px-3 sm:px-4 z-10" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-1 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 relative flex-shrink-0">
                <AMYCLogo
                  alt="AMYC"
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>
              <p className="text-center sm:text-left">
                &copy; 2026-2040 AMYC - Ansaar Muslim Youth Centre
              </p>
            </div>
            <p className="text-emerald-700/60 font-medium">
              Mfumo wa Fedha v{APP_VERSION} &middot; Offline &middot; crafted by MakalaAweso
            </p>
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
    </>
  );
}
