// ============================================================
// AMYC Financial Management System - Zustand Store
// ============================================================
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, OrgUnit, OrgLevel } from './types';

interface AuthState {
  currentUser: User | null;
  currentOrg: OrgUnit | null;
  isAuthenticated: boolean;
  authToken: string | null;
  sessionExpiresAt: number | null;
  login: (user: User, org: OrgUnit) => void;
  setAuthToken: (token: string | null) => void;
  logout: () => void;
  updateOrg: (org: OrgUnit) => void;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      currentOrg: null,
      isAuthenticated: false,
      authToken: null,
      sessionExpiresAt: null,
      login: (user, org) => set({
        currentUser: user,
        currentOrg: org,
        isAuthenticated: true,
        sessionExpiresAt: Date.now() + SESSION_TTL_MS,
      }),
      setAuthToken: (token) => set({ authToken: token }),
      logout: () =>
        set({
          currentUser: null,
          currentOrg: null,
          isAuthenticated: false,
          authToken: null,
          sessionExpiresAt: null,
        }),
      updateOrg: (org) => set({ currentOrg: org }),
    }),
    {
      name: 'amyc-auth-store',
      partialize: (state) => ({
        currentUser: state.currentUser,
        currentOrg: state.currentOrg,
        isAuthenticated: state.isAuthenticated,
        sessionExpiresAt: state.sessionExpiresAt,
        authToken: null,
      }),
      onRehydrateStorage: () => (state) => {
        // Always require fresh login on app start for security
        // This ensures APK fresh install always shows login page
        state?.logout();
      },
    }
  )
);

interface AppUIState {
  activeSection: string;
  activeSubSection: string;
  sidebarOpen: boolean;
  setActiveSection: (section: string) => void;
  setActiveSubSection: (sub: string) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<AppUIState>()(
  (set) => ({
    activeSection: 'dashboard',
    activeSubSection: '',
    sidebarOpen: true,
    setActiveSection: (section) => set({ activeSection: section, activeSubSection: '' }),
    setActiveSubSection: (sub) => set({ activeSubSection: sub }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
  })
);

// Financial year state
interface FinancialState {
  selectedYear: number;
  selectedMonth: number;
  setSelectedYear: (year: number) => void;
  setSelectedMonth: (month: number) => void;
}

export const useFinancialStore = create<FinancialState>()(
  persist(
    (set) => ({
      selectedYear: Math.max(2026, Math.min(new Date().getFullYear(), 2040)),
      selectedMonth: new Date().getMonth() + 1,
      setSelectedYear: (year) => set({ selectedYear: year }),
      setSelectedMonth: (month) => set({ selectedMonth: month }),
    }),
    { name: 'amyc-financial-store' }
  )
);
