// ============================================================
// AMYC Financial Management System - Approval Workflow Engine
// Professional Financial System for Ansaar Muslim Youth Centre
// Approval Chain: Muhasibu enters → Mweka Hazina reviews → Mudir approves
// After Tawi approval: data flows to Jimbo
// After Jimbo approval: data flows to Markaz
// ============================================================

import { db } from '@/lib/db';
import type { UserRole, OrgLevel } from './types';

// ============================================================
// Types
// ============================================================

export type ApprovalStatus = 'entered' | 'reviewed' | 'approved' | 'rejected';

export interface ApprovalAction {
  entityType: 'transaction' | 'submission' | 'budget';
  entityId: number;
  action: 'review' | 'approve' | 'reject';
  userId: number;
  userRole: UserRole;
  userOrgLevel: OrgLevel;
  notes?: string;
  rejectionReason?: string;
}

export interface ApprovalResult {
  success: boolean;
  newStatus: ApprovalStatus;
  message: string;
  notificationSent?: boolean;
}

// ============================================================
// Role → Allowed Approval Actions (Server-enforced)
// ============================================================

const ROLE_APPROVAL_ACTIONS: Record<UserRole, ApprovalStatus[]> = {
  admin: ['reviewed', 'approved'], // Admin can do both
  simple: [],
  muhasibu: [], // Muhasibu can only enter data
  mweka_hazina: ['reviewed'], // Mweka Hazina reviews
  mudir: ['approved'], // Mudir approves
  katibu: ['reviewed'], // Katibu can review at Jimbo/Markaz level
  mkaguzi: [], // Mkaguzi only views
};

/**
 * Determine the required approval chain based on org level
 * Tawi: entered → reviewed (mweka_hazina) → approved (mudir) → flows to Jimbo
 * Jimbo: entered → reviewed (katibu) → approved (mudir) → flows to Markaz
 * Markaz: entered → reviewed (katibu) → approved (admin)
 */
export function getApprovalChain(orgLevel: OrgLevel): { step: ApprovalStatus; allowedRoles: UserRole[] }[] {
  switch (orgLevel) {
    case 'tawi':
      return [
        { step: 'entered', allowedRoles: ['muhasibu', 'mweka_hazina'] },
        { step: 'reviewed', allowedRoles: ['mweka_hazina'] },
        { step: 'approved', allowedRoles: ['mudir'] },
      ];
    case 'jimbo':
      return [
        { step: 'entered', allowedRoles: ['muhasibu', 'katibu'] },
        { step: 'reviewed', allowedRoles: ['katibu'] },
        { step: 'approved', allowedRoles: ['mudir', 'admin'] },
      ];
    case 'markaz':
      return [
        { step: 'entered', allowedRoles: ['muhasibu', 'admin'] },
        { step: 'reviewed', allowedRoles: ['katibu', 'admin'] },
        { step: 'approved', allowedRoles: ['admin'] },
      ];
  }
}

/**
 * Check if a user role can perform a specific approval action at an org level
 */
export function canPerformApprovalAction(
  userRole: UserRole,
  action: 'review' | 'approve' | 'reject',
  entityOrgLevel: OrgLevel
): boolean {
  if (action === 'reject') {
    // Anyone who can review or approve can also reject
    return canPerformApprovalAction(userRole, 'review', entityOrgLevel) ||
           canPerformApprovalAction(userRole, 'approve', entityOrgLevel);
  }

  const chain = getApprovalChain(entityOrgLevel);
  const targetStatus: ApprovalStatus = action === 'review' ? 'reviewed' : 'approved';
  const step = chain.find(s => s.step === targetStatus);
  return step?.allowedRoles.includes(userRole) ?? false;
}

// ============================================================
// Transaction Approval
// ============================================================

/**
 * Process an approval action on a transaction
 */
export async function processTransactionApproval(
  action: ApprovalAction
): Promise<ApprovalResult> {
  const { entityType, entityId, action: actionType, userId, userRole, userOrgLevel, notes, rejectionReason } = action;

  if (entityType !== 'transaction') {
    throw new Error('Invalid entity type for transaction approval');
  }

  // Get the transaction
  const transaction = await db.transaction.findUnique({
    where: { id: entityId },
  });

  if (!transaction) {
    return { success: false, newStatus: 'entered', message: 'Muamala hupatikani' };
  }

  // Check if transaction is locked (already approved)
  if (transaction.isLocked) {
    return { success: false, newStatus: 'approved', message: 'Muamala umekwishaidhinishwa na hauwezi kubadilishwa' };
  }

  const currentStatus = transaction.approvalStatus as ApprovalStatus;
  const txnOrgLevel = transaction.orgLevel as OrgLevel;

  // Validate the action
  if (actionType === 'review') {
    // Can only review if current status is 'entered'
    if (currentStatus !== 'entered') {
      return { success: false, newStatus: currentStatus, message: `Muamala hauko katika hali ya kuhakiki (hali ya sasa: ${currentStatus})` };
    }
    if (!canPerformApprovalAction(userRole, 'review', txnOrgLevel)) {
      return { success: false, newStatus: currentStatus, message: 'Hauna ruhusa ya kuhakiki muamala huu' };
    }

    // Update to reviewed
    await db.transaction.update({
      where: { id: entityId },
      data: {
        approvalStatus: 'reviewed',
        reviewerId: userId,
        reviewedAt: new Date(),
        reviewNotes: notes || null,
      },
    });

    // Create approval step
    await db.approvalStep.create({
      data: {
        entityType: 'transaction',
        entityId,
        step: 'reviewed',
        userId,
        notes: notes || null,
        previousStatus: 'entered',
        newStatus: 'reviewed',
      },
    });

    // Create notification for approvers
    await notifyApprovers(transaction.orgUnitId, 'transaction', entityId, 'reviewed');

    return { success: true, newStatus: 'reviewed', message: 'Muamala umehakikiwa kwa mafanikio', notificationSent: true };

  } else if (actionType === 'approve') {
    // Can only approve if current status is 'reviewed'
    if (currentStatus !== 'reviewed') {
      return { success: false, newStatus: currentStatus, message: `Muamala hauko katika hali ya kuidhinishwa (hali ya sasa: ${currentStatus})` };
    }
    if (!canPerformApprovalAction(userRole, 'approve', txnOrgLevel)) {
      return { success: false, newStatus: currentStatus, message: 'Hauna ruhusa ya kuidhinisha muamala huu' };
    }

    // Update to approved and lock
    await db.transaction.update({
      where: { id: entityId },
      data: {
        approvalStatus: 'approved',
        approverId: userId,
        approvedAt: new Date(),
        approvalNotes: notes || null,
        isLocked: true,
        isSubmitted: true,
        submittedAt: new Date(),
      },
    });

    // Create approval step
    await db.approvalStep.create({
      data: {
        entityType: 'transaction',
        entityId,
        step: 'approved',
        userId,
        notes: notes || null,
        previousStatus: 'reviewed',
        newStatus: 'approved',
      },
    });

    // Notify the data entry person
    await notifyDataEntry(transaction.enteredBy, 'transaction', entityId, 'approved');

    return { success: true, newStatus: 'approved', message: 'Muamala umeidhinishwa kwa mafanikio', notificationSent: true };

  } else if (actionType === 'reject') {
    // Can reject if current status is 'entered' or 'reviewed'
    if (currentStatus !== 'entered' && currentStatus !== 'reviewed') {
      return { success: false, newStatus: currentStatus, message: 'Hauwezi kukataa muamala katika hali hii' };
    }
    if (!canPerformApprovalAction(userRole, 'reject', txnOrgLevel)) {
      return { success: false, newStatus: currentStatus, message: 'Hauna ruhusa ya kukataa muamala huu' };
    }

    // Update to rejected
    await db.transaction.update({
      where: { id: entityId },
      data: {
        approvalStatus: 'rejected',
        rejectedBy: userId,
        rejectedAt: new Date(),
        rejectionReason: rejectionReason || notes || null,
      },
    });

    // Create approval step
    await db.approvalStep.create({
      data: {
        entityType: 'transaction',
        entityId,
        step: 'rejected',
        userId,
        notes: rejectionReason || notes || null,
        previousStatus: currentStatus,
        newStatus: 'rejected',
      },
    });

    // Notify the data entry person
    await notifyDataEntry(transaction.enteredBy, 'transaction', entityId, 'rejected');

    return { success: true, newStatus: 'rejected', message: 'Muamala umekataliwa', notificationSent: true };
  }

  return { success: false, newStatus: currentStatus, message: 'Kitendo hakijulikani' };
}

// ============================================================
// Submission Approval (Jimbo → Markaz flow)
// ============================================================

/**
 * Process an approval action on a monthly submission
 * When Tawi submission is approved: it auto-flows to parent Jimbo
 * When Jimbo submission is approved: it auto-flows to Markaz
 */
export async function processSubmissionApproval(
  action: ApprovalAction & { orgUnitId: number; month: number; year: number }
): Promise<ApprovalResult> {
  const { entityId, action: actionType, userId, userRole, notes, rejectionReason, orgUnitId, month, year } = action;

  // Get the submission
  const submission = await db.monthlySubmission.findUnique({
    where: { id: entityId },
    include: { orgUnit: true },
  });

  if (!submission) {
    return { success: false, newStatus: 'entered', message: 'Mawasilisho hayapatikani' };
  }

  const currentStatus = submission.approvalStatus as ApprovalStatus;
  const subOrgLevel = submission.orgUnit?.type as OrgLevel;

  if (actionType === 'review') {
    if (currentStatus !== 'entered') {
      return { success: false, newStatus: currentStatus, message: 'Mawasilisho hayako katika hali ya kuhakiki' };
    }
    if (!canPerformApprovalAction(userRole, 'review', subOrgLevel)) {
      return { success: false, newStatus: currentStatus, message: 'Hauna ruhusa ya kuhakiki mawasilisho haya' };
    }

    await db.monthlySubmission.update({
      where: { id: entityId },
      data: {
        approvalStatus: 'reviewed',
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewNotes: notes || null,
      },
    });

    await db.approvalStep.create({
      data: {
        entityType: 'submission',
        entityId,
        step: 'reviewed',
        userId,
        notes: notes || null,
        previousStatus: 'entered',
        newStatus: 'reviewed',
      },
    });

    return { success: true, newStatus: 'reviewed', message: 'Mawasilisho yamehakikiwa kwa mafanikio' };

  } else if (actionType === 'approve') {
    if (currentStatus !== 'reviewed') {
      return { success: false, newStatus: currentStatus, message: 'Mawasilisho hayako katika hali ya kuidhinishwa' };
    }
    if (!canPerformApprovalAction(userRole, 'approve', subOrgLevel)) {
      return { success: false, newStatus: currentStatus, message: 'Hauna ruhusa ya kuidhinisha mawasilisho haya' };
    }

    // Approve and lock transactions
    await db.monthlySubmission.update({
      where: { id: entityId },
      data: {
        approvalStatus: 'approved',
        approverId: userId,
        approvedAt: new Date(),
        approvalNotes: notes || null,
      },
    });

    // Lock all transactions for this org/month/year
    await db.transaction.updateMany({
      where: {
        orgUnitId: submission.orgUnitId,
        month: submission.month,
        year: submission.year,
        isLocked: false,
      },
      data: {
        isLocked: true,
        isSubmitted: true,
        submittedAt: new Date(),
        approvalStatus: 'approved',
        approverId: userId,
        approvedAt: new Date(),
      },
    });

    await db.approvalStep.create({
      data: {
        entityType: 'submission',
        entityId,
        step: 'approved',
        userId,
        notes: notes || null,
        previousStatus: 'reviewed',
        newStatus: 'approved',
      },
    });

    // Auto-flow to parent: Create or update submission at parent level
    if (submission.orgUnit?.parentId) {
      await autoFlowToParent(submission.orgUnitId, submission.orgUnit.parentId, month, year, userId);
    }

    return { success: true, newStatus: 'approved', message: 'Mawasilisho yameidhinishwa kwa mafanikio. Taarifa zimepelekwa ngazi ya juu.', notificationSent: true };

  } else if (actionType === 'reject') {
    if (currentStatus !== 'entered' && currentStatus !== 'reviewed') {
      return { success: false, newStatus: currentStatus, message: 'Hauwezi kukataa mawasilisho katika hali hii' };
    }

    await db.monthlySubmission.update({
      where: { id: entityId },
      data: {
        approvalStatus: 'rejected',
        rejectedBy: userId,
        rejectedAt: new Date(),
        rejectionReason: rejectionReason || notes || null,
      },
    });

    await db.approvalStep.create({
      data: {
        entityType: 'submission',
        entityId,
        step: 'rejected',
        userId,
        notes: rejectionReason || notes || null,
        previousStatus: currentStatus,
        newStatus: 'rejected',
      },
    });

    return { success: true, newStatus: 'rejected', message: 'Mawasilisho yamekataliwa' };
  }

  return { success: false, newStatus: currentStatus, message: 'Kitendo hakijulikani' };
}

// ============================================================
// Auto-Flow to Parent (Tawi → Jimbo → Markaz)
// ============================================================

/**
 * When a submission is approved at one level, automatically create/update
 * the submission at the parent level so the parent can see it.
 */
async function autoFlowToParent(
  childOrgId: number,
  parentOrgId: number,
  month: number,
  year: number,
  approvedByUserId: number
): Promise<void> {
  // Get child's submission totals
  const childTxns = await db.transaction.findMany({
    where: {
      orgUnitId: childOrgId,
      month,
      year,
      isOpening: false,
    },
    select: { type: true, amount: true },
  });

  const childIncome = childTxns
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const childExpense = childTxns
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  // Create or update parent submission (or just a record that child has submitted)
  // The parent will see this when they view their consolidated data

  // Notify parent-level users
  const parentOrg = await db.orgUnit.findUnique({
    where: { id: parentOrgId },
  });

  if (parentOrg) {
    const childOrg = await db.orgUnit.findUnique({
      where: { id: childOrgId },
    });

    // Find users at parent level who should be notified
    const parentUsers = await db.user.findMany({
      where: {
        orgUnitId: parentOrgId,
        isActive: true,
        role: { in: ['mudir', 'katibu', 'admin'] },
      },
    });

    for (const pUser of parentUsers) {
      await db.notification.create({
        data: {
          userId: pUser.id,
          type: 'submission_received',
          title: `Taarifa mpya kutoka ${childOrg?.name || 'Tawi'}`,
          message: `${childOrg?.name || 'Tawi'} amewasilisha taarifa za ${getMonthName(month)} ${year}. Mapato: ${formatAmount(childIncome)}, Matumizi: ${formatAmount(childExpense)}`,
          entityType: 'submission',
          entityId: 0, // Will be updated when parent creates their submission
          orgUnitId: parentOrgId,
          priority: 'high',
        },
      });
    }
  }
}

// ============================================================
// Helpers
// ============================================================

function getMonthName(month: number): string {
  const months = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni',
    'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  return months[month - 1] || '';
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('sw-TZ', { style: 'decimal' }).format(amount);
}

/**
 * Notify approvers at an org that data needs their attention
 */
async function notifyApprovers(
  orgUnitId: number,
  entityType: string,
  entityId: number,
  status: string
): Promise<void> {
  const org = await db.orgUnit.findUnique({ where: { id: orgUnitId } });
  if (!org) return;

  // Find users who can approve at this level
  const chain = getApprovalChain(org.type as OrgLevel);
  const nextStep = chain.find(s => s.step === (status === 'reviewed' ? 'approved' : 'reviewed'));

  if (!nextStep) return;

  const approvers = await db.user.findMany({
    where: {
      orgUnitId,
      isActive: true,
      role: { in: nextStep.allowedRoles as UserRole[] },
    },
  });

  for (const approver of approvers) {
    await db.notification.create({
      data: {
        userId: approver.id,
        type: 'approval_needed',
        title: `Taarifa zinahitaji ${status === 'reviewed' ? 'uidhinishaji' : 'uhakiki'}`,
        message: `Kuna taarifa mpya zinahitaji ${status === 'reviewed' ? 'uidhinishaji' : 'uhakiki'} wako katika ${org.name}`,
        entityType,
        entityId,
        orgUnitId,
        priority: 'high',
      },
    });
  }
}

/**
 * Notify the data entry person about approval/rejection
 */
async function notifyDataEntry(
  enteredBy: number | null,
  entityType: string,
  entityId: number,
  status: string
): Promise<void> {
  if (enteredBy === null) {
    return;
  }

  const statusMsg = status === 'approved'
    ? 'zimeidhinishwa'
    : status === 'rejected'
    ? 'zimekataliwa'
    : 'zimehakikiwa';

  await db.notification.create({
    data: {
      userId: enteredBy,
      type: status === 'approved' ? 'approval_granted' : status === 'rejected' ? 'approval_rejected' : 'approval_needed',
      title: `Taarifa ${statusMsg}`,
      message: `Taarifa ulizoingiza ${statusMsg}. ${status === 'rejected' ? 'Tafadhali rekebisha na kuwasilisha tena.' : ''}`,
      entityType,
      entityId,
      priority: status === 'rejected' ? 'high' : 'normal',
    },
  });
}

// ============================================================
// Get Approval Status Summary
// ============================================================

export async function getApprovalSummary(orgUnitId: number, month?: number, year?: number) {
  const yr = year || new Date().getFullYear();
  const mo = month || new Date().getMonth() + 1;

  const [entered, reviewed, approved, rejected] = await Promise.all([
    db.transaction.count({
      where: { orgUnitId, approvalStatus: 'entered', month: mo, year: yr },
    }),
    db.transaction.count({
      where: { orgUnitId, approvalStatus: 'reviewed', month: mo, year: yr },
    }),
    db.transaction.count({
      where: { orgUnitId, approvalStatus: 'approved', month: mo, year: yr },
    }),
    db.transaction.count({
      where: { orgUnitId, approvalStatus: 'rejected', month: mo, year: yr },
    }),
  ]);

  return { entered, reviewed, approved, rejected, total: entered + reviewed + approved + rejected };
}

/**
 * Get child submission status for Jimbo/Markaz consolidated view
 */
export async function getChildSubmissionsForConsolidation(
  parentOrgId: number,
  month: number,
  year: number
) {
  const children = await db.orgUnit.findMany({
    where: { parentId: parentOrgId, isActive: true },
    orderBy: { name: 'asc' },
  });

  const results: any[] = [];
  for (const child of children) {
    const submission = await db.monthlySubmission.findUnique({
      where: { orgUnitId_month_year: { orgUnitId: child.id, month, year } },
    });

    // Get monthly totals regardless of submission
    const txns = await db.transaction.findMany({
      where: { orgUnitId: child.id, month, year, isOpening: false },
      select: { type: true, amount: true, approvalStatus: true },
    });

    const totalIncome = txns
      .filter(t => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);
    const totalExpense = txns
      .filter(t => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);

    const approvedIncome = txns
      .filter(t => t.type === 'income' && t.approvalStatus === 'approved')
      .reduce((s, t) => s + t.amount, 0);
    const approvedExpense = txns
      .filter(t => t.type === 'expense' && t.approvalStatus === 'approved')
      .reduce((s, t) => s + t.amount, 0);

    results.push({
      orgUnitId: child.id,
      orgUnitName: child.name,
      orgLevel: child.type,
      code: child.code,
      isSubmitted: submission?.isSubmitted ?? false,
      submittedAt: submission?.submittedAt ?? null,
      approvalStatus: submission?.approvalStatus ?? 'entered',
      totalIncome,
      totalExpense,
      netBalance: totalIncome - totalExpense,
      approvedIncome,
      approvedExpense,
      transactionCount: txns.length,
    });
  }

  return results;
}
