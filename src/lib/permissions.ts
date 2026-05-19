// ============================================================
// AMYC Financial Management System - Permission System
// Server-side enforced with full RBAC
// Approval Flow: Muhasibu enters → Mweka Hazina reviews → Mudir approves
// ============================================================
import type { UserRole, OrgLevel } from './types';
import { ROLE_CONFIG } from './types';

// Check if a user can enter financial data
export function canEnterData(role: UserRole): boolean {
  return ROLE_CONFIG[role]?.canEnterData ?? false;
}

// Check if a user can view financial data
export function canViewData(role: UserRole): boolean {
  return ROLE_CONFIG[role]?.canViewData ?? false;
}

// Check if a user can register sub-units
export function canRegisterSubUnits(role: UserRole): boolean {
  return ROLE_CONFIG[role]?.canRegisterSubUnits ?? false;
}

// Check if a user can manage other users
export function canManageUsers(role: UserRole): boolean {
  return ROLE_CONFIG[role]?.canManageUsers ?? false;
}

// Check if a user can access the admin panel
export function canAccessAdmin(role: UserRole): boolean {
  return ROLE_CONFIG[role]?.canAccessAdmin ?? false;
}

// Check if a role is valid at a specific org level
export function isRoleValidAtLevel(role: UserRole, level: OrgLevel): boolean {
  return ROLE_CONFIG[role]?.allowedLevels.includes(level) ?? false;
}

// Get the org levels that a role can access
export function getAllowedLevels(role: UserRole): OrgLevel[] {
  return ROLE_CONFIG[role]?.allowedLevels ?? [];
}

// ============================================================
// NEW: Approval Workflow Permissions
// ============================================================

// Check if a user can review (verify) data
export function canReviewData(role: UserRole): boolean {
  return ['mweka_hazina', 'katibu', 'mudir', 'admin'].includes(role);
}

// Check if a user can approve data
export function canApproveData(role: UserRole): boolean {
  return ['mudir', 'admin'].includes(role);
}

// Check if a user can reject data
export function canRejectData(role: UserRole): boolean {
  return canReviewData(role) || canApproveData(role);
}

// Check if a user can submit data for approval
export function canSubmitData(role: UserRole): boolean {
  return canEnterData(role);
}

// Get the next approval action a user can take on an entity
export function getNextApprovalAction(role: UserRole, currentStatus: string): 'review' | 'approve' | 'reject' | null {
  if (currentStatus === 'entered' && canReviewData(role)) return 'review';
  if (currentStatus === 'reviewed' && canApproveData(role)) return 'approve';
  if ((currentStatus === 'entered' || currentStatus === 'reviewed') && canRejectData(role)) return 'reject';
  return null;
}

// ============================================================
// Organization Scope
// ============================================================

// Check if user can see data from a specific org unit
// Tawi: sees only its own data
// Jimbo: sees own + child Tawi data
// Markaz: sees own + child Jimbo + grandchild Tawi data (full hierarchy)
export function canSeeOrgData(userOrgLevel: OrgLevel, userOrgId: number, targetOrgId: number, userOrgParentId: number | null): boolean {
  // Same org - always can see
  if (userOrgId === targetOrgId) return true;

  // Markaz can see everything below it (checked at query time)
  // Jimbo can see its children (checked at query time)
  // Tawi can only see itself
  return userOrgLevel !== 'tawi';
}

// Get the hierarchy depth a user can drill down to
export function getDrillDownDepth(orgLevel: OrgLevel): number {
  switch (orgLevel) {
    case 'markaz': return 3; // Can see Markaz -> Jimbo -> Tawi
    case 'jimbo': return 2;  // Can see Jimbo -> Tawi
    case 'tawi': return 1;   // Can only see Tawi
  }
}

// Role display label
export function getRoleLabel(role: UserRole): string {
  return ROLE_CONFIG[role]?.label || role;
}

// Get visible navigation items based on role
export function getVisibleNavItems(role: UserRole, orgLevel: OrgLevel): string[] {
  const baseItems = ['dashboard'];

  // Data entry - only for roles that can enter data
  if (canEnterData(role)) {
    baseItems.push('income', 'expense');
  }

  // Transaction list - visible to all who can view data
  if (canViewData(role)) {
    baseItems.push('transactions');
  }

  // Approval workflow - for reviewers and approvers
  if (canReviewData(role) || canApproveData(role)) {
    baseItems.push('approvals');
  }

  // Reports - visible to all who can view data
  if (canViewData(role)) {
    baseItems.push('reports');
  }

  // Organization - visible to those who can register sub-units or admins
  if (canRegisterSubUnits(role) || canAccessAdmin(role) || canViewData(role)) {
    baseItems.push('organization');
  }

  // Excel - only for data entry roles
  if (canEnterData(role)) {
    baseItems.push('excel');
  }

  // Categories - visible to all who can view data
  if (canViewData(role)) {
    baseItems.push('categories');
  }

  // Notes - visible to all
  baseItems.push('notes');

  // Admin panel - only for admin role
  if (canAccessAdmin(role)) {
    baseItems.push('admin');
  }

  // Settings - always visible
  baseItems.push('settings');

  return baseItems;
}
