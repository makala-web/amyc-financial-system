'use client';

import Image from 'next/image';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAuthStore, useFinancialStore, useUIStore } from '@/lib/store';
import SyncIndicator from '@/components/pwa/SyncIndicator';
import type { OrgLevel } from '@/lib/types';

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

const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Dashibodi',
  income: 'Mapato',
  expense: 'Matumizi',
  budget: 'Bajeti',
  reports: 'Ripoti',
  performance: 'Ripoti ya Utendaji',
  organization: 'Muundo wa Taasisi',
  excel: 'Excel',
  notes: 'Vikumbusho',
  settings: 'Mipangilio',
};

export default function AppHeader() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const currentOrg = useAuthStore((s) => s.currentOrg);
  const logout = useAuthStore((s) => s.logout);
  const selectedYear = useFinancialStore((s) => s.selectedYear);
  const setSelectedYear = useFinancialStore((s) => s.setSelectedYear);
  const activeSection = useUIStore((s) => s.activeSection);

  const activeSectionLabel = SECTION_LABELS[activeSection] || activeSection;

  const userInitials = currentUser?.fullName
    ? currentUser.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  // Generate year options (2026 to 2040)
  const years = Array.from({ length: 15 }, (_, i) => 2026 + i);

  return (
    <header className="sticky top-0 z-30 flex h-14 sm:h-16 items-center gap-2 sm:gap-3 border-b border-emerald-100 bg-white/95 backdrop-blur-sm px-2 sm:px-4 shadow-sm" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingLeft: 'max(0.5rem, env(safe-area-inset-left, 0px))', paddingRight: 'max(0.5rem, env(safe-area-inset-right, 0px))' }}>
      {/* Mobile menu toggle - 44px touch target */}
      <SidebarTrigger className="text-emerald-700 hover:bg-emerald-50 min-h-[44px] min-w-[44px] flex items-center justify-center" />

      {/* AMYC Logo - visible in header */}
      <div className="flex items-center gap-2 sm:gap-2.5 mr-0 sm:mr-1">
        <div className="w-8 h-8 sm:w-9 sm:h-9 relative flex-shrink-0 bg-emerald-50 rounded-lg p-0.5">
          <Image
            src="/logo-amyc.png"
            alt="AMYC"
            fill
            className="object-contain"
            priority
          />
        </div>
        <div className="hidden sm:flex flex-col leading-tight">
          <span className="text-sm font-bold text-emerald-800">AMYC</span>
          <span className="text-[10px] text-emerald-600">Mfumo wa Fedha</span>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-emerald-200 hidden sm:block" />

      {/* Current section title and org info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex flex-col min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {activeSectionLabel}
          </h2>
          <p className="text-xs text-muted-foreground truncate">
            <span className="font-medium text-emerald-700">{currentOrg?.name || 'Taasisi'}</span>
            {currentOrg?.type && (
              <span className="ml-1.5 inline-flex items-center rounded-sm bg-emerald-100 px-1.5 py-0 text-[10px] font-semibold text-emerald-700 align-middle">
                {ORG_LEVEL_LABELS[currentOrg.type]}
              </span>
            )}
          </p>
        </div>
      </div>

      <SyncIndicator />

      {/* Year Picker */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground hidden sm:inline font-medium">Mwaka:</span>
        <Select
          value={String(selectedYear)}
          onValueChange={(val) => setSelectedYear(parseInt(val))}
        >
          <SelectTrigger className="w-[80px] sm:w-[100px] min-h-[44px] sm:min-h-0 text-sm border-emerald-200 focus:ring-emerald-300 font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* User Dropdown - 44px touch target */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="relative h-11 w-11 sm:h-9 sm:w-9 rounded-full border-2 border-emerald-200 hover:border-emerald-300 p-0 transition-all duration-200 hover:shadow-sm"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-emerald-100 text-emerald-700 text-xs font-semibold">
                {userInitials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">
                {currentUser?.fullName || 'Mtumiaji'}
              </p>
              <p className="text-xs leading-none text-muted-foreground">
                {currentUser?.role
                  ? ROLE_LABELS[currentUser.role] || currentUser.role
                  : ''}
              </p>
              <p className="text-xs leading-none text-emerald-600 font-medium">
                {currentOrg?.name || ''}{' '}
                {currentOrg?.type
                  ? `- ${ORG_LEVEL_LABELS[currentOrg.type]}`
                  : ''}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={logout}
            className="text-red-600 focus:text-red-700 focus:bg-red-50 cursor-pointer min-h-[44px]"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Toka kwenye Akaunti
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
