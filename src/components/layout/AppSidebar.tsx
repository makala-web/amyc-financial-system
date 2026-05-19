'use client';

import Image from 'next/image';
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  FileText,
  Building2,
  FileSpreadsheet,
  StickyNote,
  Settings,
  LogOut,
  Calculator,
  ClipboardList,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuthStore, useUIStore } from '@/lib/store';
import type { OrgLevel } from '@/lib/types';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashibodi', icon: LayoutDashboard },
  { id: 'income', label: 'Mapato', icon: TrendingUp },
  { id: 'expense', label: 'Matumizi', icon: TrendingDown },
  { id: 'budget', label: 'Bajeti', icon: Calculator },
  { id: 'reports', label: 'Ripoti', icon: FileText },
  { id: 'performance', label: 'Ripoti ya Utendaji', icon: ClipboardList },
  { id: 'organization', label: 'Muundo wa Taasisi', icon: Building2 },
  { id: 'excel', label: 'Excel', icon: FileSpreadsheet },
  { id: 'notes', label: 'Vikumbusho', icon: StickyNote },
  { id: 'settings', label: 'Mipangilio', icon: Settings },
] as const;

/**
 * Returns the display label for a nav item, adjusted for the user's org level.
 * - Excel: Jimbo sees "Pakia Ripoti za Tawi", Markaz sees "Pakia Ripoti za Jimbo"
 * - Organization: Jimbo sees "Usajili wa Matawi", Markaz sees "Usajili wa Majimbo"
 */
function getNavLabel(itemId: string, orgType?: OrgLevel): string {
  switch (itemId) {
    case 'excel':
      return orgType === 'markaz'
        ? 'Pakia Ripoti za Jimbo'
        : orgType === 'jimbo'
          ? 'Pakia Ripoti za Tawi'
          : 'Excel';
    case 'organization':
      return orgType === 'markaz'
        ? 'Usajili wa Majimbo'
        : orgType === 'jimbo'
          ? 'Usajili wa Matawi'
          : 'Muundo wa Taasisi';
    default:
      return NAV_ITEMS.find((i) => i.id === itemId)?.label || itemId;
  }
}

/**
 * Filters nav items based on org level:
 * - Tawi: no organization management, no Excel upload
 * - Jimbo: all items (organization shows Tawi registration, Excel shows Tawi upload)
 * - Markaz: all items (full organization management, Jimbo Excel upload)
 */
function getFilteredNavItems(orgType?: OrgLevel) {
  return NAV_ITEMS.filter((item) => {
    if (orgType === 'tawi') {
      // Tawi: no organization management, no Excel
      return !['organization', 'excel'].includes(item.id);
    }
    // Jimbo and Markaz: all items visible
    return true;
  });
}

const ORG_LEVEL_LABELS: Record<OrgLevel, string> = {
  tawi: 'Tawi',
  jimbo: 'Jimbo',
  markaz: 'Markaz Kuu',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Msimamizi Mkuu/ADMIN',
  simple: 'Mtumiaji',
  mudir: 'Mudir',
  katibu: 'Katibu',
  mwekahazina: 'Mwekahazina',
  muhasibu: 'Muhasibu',
};

export default function AppSidebar() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const currentOrg = useAuthStore((s) => s.currentOrg);
  const logout = useAuthStore((s) => s.logout);
  const activeSection = useUIStore((s) => s.activeSection);
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const { isMobile, setOpenMobile } = useSidebar();

  const userInitials = currentUser?.fullName
    ? currentUser.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  const handleNavClick = (sectionId: string) => {
    setActiveSection(sectionId);
    // Auto-close sidebar on mobile using the sidebar component's own state
    // Also check window.innerWidth directly as a fallback for cases where
    // the useIsMobile hook may not have initialized yet (SSR/hydration)
    if (isMobile || (typeof window !== 'undefined' && window.innerWidth < 768)) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar className="border-r border-emerald-100 bg-white">
      {/* Header - Logo and Branding */}
      <SidebarHeader className="p-3 bg-gradient-to-r from-emerald-700 to-emerald-600">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 relative flex-shrink-0 bg-white rounded-xl p-1 shadow-sm">
            <Image
              src="/logo-amyc.png"
              alt="AMYC Logo"
              fill
              className="object-contain"
              priority
            />
          </div>
          <div className="flex flex-col">
            <span className="text-white font-bold text-lg leading-tight">
              AMYC
            </span>
            <span className="text-emerald-100 text-xs leading-tight">
              Mfumo wa Fedha
            </span>
          </div>
        </div>
      </SidebarHeader>

      {/* User Info */}
      <div className="px-3 py-2.5 border-b border-emerald-50">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border-2 border-emerald-200 shadow-sm">
            <AvatarFallback className="bg-emerald-100 text-emerald-700 text-xs font-semibold">
              {userInitials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              {currentUser?.fullName || 'Mtumiaji'}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {currentUser?.role ? ROLE_LABELS[currentUser.role] || currentUser.role : ''} &middot;{' '}
              {currentOrg?.name || ''}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <SidebarContent className="px-2 py-2 overflow-y-auto">
        <SidebarGroup>
          <SidebarGroupLabel className="text-emerald-700 font-semibold text-xs uppercase tracking-wider">
            Menyu Kuu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {getFilteredNavItems(currentOrg?.type).map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const label = getNavLabel(item.id, currentOrg?.type);
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => handleNavClick(item.id)}
                      className={`
                        group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 cursor-pointer
                        ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-800 shadow-sm'
                            : 'text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 hover:translate-x-0.5'
                        }
                      `}
                      tooltip={label}
                    >
                      <Icon
                        className={`h-5 w-5 flex-shrink-0 transition-transform duration-200 ${
                          isActive
                            ? 'text-emerald-700 scale-110'
                            : 'text-muted-foreground group-hover:text-emerald-600 group-hover:scale-105'
                        }`}
                      />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Org Level Badge */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">
          <Building2 className="h-4 w-4 text-emerald-600" />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-emerald-800 truncate">
              {currentOrg?.name || 'Taasisi'}
            </span>
            <span className="text-[10px] text-emerald-600">
              {currentOrg?.type ? ORG_LEVEL_LABELS[currentOrg.type] : ''}
            </span>
          </div>
        </div>
      </div>

      <SidebarSeparator />

      {/* Footer - Logout */}
      <SidebarFooter className="p-3">
        <Button
          variant="ghost"
          onClick={logout}
          className="w-full justify-start gap-3 text-red-600 hover:text-red-700 hover:bg-red-50 font-medium min-h-[44px] transition-all duration-200"
        >
          <LogOut className="h-5 w-5" />
          <span>Toka</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
