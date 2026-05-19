'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { db, getChildOrgUnits, getOrgUnitById, findOrCreateOrgUnit } from '@/lib/db-offline';
import type { OrgUnit, OrgLevel } from '@/lib/types';
import { useAuthStore } from '@/lib/store';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import {
  Building2,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Ban,
  TreePine,
  RefreshCw,
  Users,
  CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Helpers ──────────────────────────────────────────────
const ORG_LABELS: Record<OrgLevel, string> = {
  markaz: 'Markaz Kuu',
  jimbo: 'Jimbo',
  tawi: 'Tawi',
};

const ORG_COLORS: Record<OrgLevel, string> = {
  markaz: 'bg-emerald-700 text-white',
  jimbo: 'bg-emerald-500 text-white',
  tawi: 'bg-emerald-300 text-emerald-900',
};

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ────────────────────────────────────────────
export default function OrganizationManager() {
  const { currentOrg, currentUser } = useAuthStore();
  const [orgTree, setOrgTree] = useState<OrgUnit[]>([]);
  const [childrenMap, setChildrenMap] = useState<Record<number, OrgUnit[]>>({});
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedOrg, setSelectedOrg] = useState<OrgUnit | null>(null);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addParent, setAddParent] = useState<OrgUnit | null>(null);
  const [addName, setAddName] = useState('');
  const [addCode, setAddCode] = useState('');

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<OrgUnit | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');

  // ── Sub-unit registration states ────────────────────────
  const [subUnitName, setSubUnitName] = useState('');
  const [subUnitRegistering, setSubUnitRegistering] = useState(false);
  const [mySubUnits, setMySubUnits] = useState<OrgUnit[]>([]);

  // Determine what sub-unit type the current org can register
  const canRegisterSubUnits = currentOrg?.type === 'jimbo' || currentOrg?.type === 'markaz';
  const subUnitTypeLabel = currentOrg?.type === 'jimbo' ? 'Tawi' : currentOrg?.type === 'markaz' ? 'Jimbo' : '';
  const subUnitTypeLabelPlural = currentOrg?.type === 'jimbo' ? 'Matawi' : currentOrg?.type === 'markaz' ? 'Majimbo' : '';
  const subUnitOrgType: OrgLevel | null = currentOrg?.type === 'jimbo' ? 'tawi' : currentOrg?.type === 'markaz' ? 'jimbo' : null;

  // ── Load my sub-units ──────────────────────────────────
  const loadMySubUnits = useCallback(async () => {
    if (!currentOrg?.id || !canRegisterSubUnits) return;
    try {
      const children = await getChildOrgUnits(currentOrg.id);
      setMySubUnits(children);
    } catch {
      // silently handle
    }
  }, [currentOrg?.id, canRegisterSubUnits]);

  useEffect(() => {
    loadMySubUnits();
  }, [loadMySubUnits]);

  // ── Handle sub-unit registration ────────────────────────
  const handleRegisterSubUnit = async () => {
    if (!subUnitName.trim() || !subUnitOrgType || !currentOrg?.id) return;

    setSubUnitRegistering(true);
    try {
      const newUnit = await findOrCreateOrgUnit(
        subUnitName.trim(),
        subUnitOrgType,
        currentOrg.id,
      );

      toast.success(
        `${subUnitTypeLabel} "${newUnit.name}" imesajiliwa kikamilifu!`,
        {
          description: `Msimbo: ${newUnit.code}`,
          icon: <CheckCircle className="h-4 w-4 text-emerald-600" />,
        }
      );

      setSubUnitName('');
      await loadMySubUnits();
      await loadOrgTree();
    } catch (error) {
      toast.error('Hitilafu katika kusajili kitengo', {
        description: 'Tafadhali jaribu tena.',
      });
    } finally {
      setSubUnitRegistering(false);
    }
  };

  // ── Handle sub-unit edit ────────────────────────────────
  const handleEditSubUnit = (org: OrgUnit) => {
    setEditOrg(org);
    setEditName(org.name);
    setEditCode(org.code);
    setEditDialogOpen(true);
  };

  // ── Handle sub-unit deactivate ──────────────────────────
  const handleDeactivateSubUnit = async (org: OrgUnit) => {
    await db.orgUnits.update(org.id!, {
      isActive: false,
      updatedAt: new Date().toISOString(),
    });
    await loadMySubUnits();
    await loadOrgTree();
    toast.info(`Kitengo "${org.name}" kimesitishwa.`);
  };

  // ── Load org tree ──────────────────────────────────────
  const loadOrgTree = useCallback(async () => {
    setLoading(true);
    try {
      // Get all org units
      const allOrgs = await db.orgUnits.toArray();
      const activeOrgs = allOrgs.filter((o) => o.isActive);

      // Build children map
      const cMap: Record<number, OrgUnit[]> = {};
      for (const org of activeOrgs) {
        if (org.parentId !== null) {
          if (!cMap[org.parentId]) cMap[org.parentId] = [];
          cMap[org.parentId].push(org);
        }
      }

      // Scope tree by current user's organization level:
      // markaz -> sees own markaz + children
      // jimbo -> sees own jimbo + children (matawi)
      // tawi -> sees own tawi only
      let scopedRoots: OrgUnit[] = [];
      if (currentOrg?.id) {
        const me = activeOrgs.find((o) => o.id === currentOrg.id);
        if (me) scopedRoots = [me];
      } else {
        scopedRoots = activeOrgs.filter((o) => o.type === 'markaz');
      }

      setOrgTree(scopedRoots);
      setChildrenMap(cMap);

      // Auto-expand current root
      const expanded = new Set<number>();
      scopedRoots.forEach((root) => expanded.add(root.id!));
      setExpandedIds(expanded);
    } finally {
      setLoading(false);
    }
  }, [currentOrg?.id]);

  useEffect(() => {
    loadOrgTree();
  }, [loadOrgTree]);

  // ── Toggle expand ──────────────────────────────────────
  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Add org unit ──────────────────────────────────────
  const handleAddOrg = async () => {
    if (!addParent || !addName.trim() || !addCode.trim()) return;

    const childType: OrgLevel = addParent.type === 'markaz' ? 'jimbo' : 'tawi';

    await db.orgUnits.add({
      name: addName.trim(),
      code: addCode.trim().toUpperCase(),
      type: childType,
      parentId: addParent.id!,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    setAddDialogOpen(false);
    setAddName('');
    setAddCode('');
    setAddParent(null);
    await loadOrgTree();
  };

  // ── Edit org unit ──────────────────────────────────────
  const handleEditOrg = async () => {
    if (!editOrg || !editName.trim() || !editCode.trim()) return;

    await db.orgUnits.update(editOrg.id!, {
      name: editName.trim(),
      code: editCode.trim().toUpperCase(),
      updatedAt: new Date().toISOString(),
    });

    setEditDialogOpen(false);
    setEditOrg(null);
    setEditName('');
    setEditCode('');
    await loadMySubUnits();
    await loadOrgTree();
  };

  // ── Deactivate org unit ──────────────────────────────
  const handleDeactivate = async (org: OrgUnit) => {
    await db.orgUnits.update(org.id!, {
      isActive: false,
      updatedAt: new Date().toISOString(),
    });
    await loadMySubUnits();
    await loadOrgTree();
  };

  // ── Open add dialog ────────────────────────────────────
  const openAddDialog = (parent: OrgUnit) => {
    if (!currentOrg) return;
    if (currentOrg.type === 'jimbo' && parent.id !== currentOrg.id) return;
    if (currentOrg.type === 'markaz' && parent.type !== 'markaz') return;
    setAddParent(parent);
    setAddName('');
    setAddCode('');
    setAddDialogOpen(true);
  };

  // ── Open edit dialog ───────────────────────────────────
  const openEditDialog = (org: OrgUnit) => {
    setEditOrg(org);
    setEditName(org.name);
    setEditCode(org.code);
    setEditDialogOpen(true);
  };

  // ── Get child type label ──────────────────────────────
  const getChildTypeLabel = (parent: OrgUnit): string => {
    if (parent.type === 'markaz') return 'Jimbo';
    if (parent.type === 'jimbo') return 'Tawi';
    return '';
  };

  // ── Render sub-unit registration section ───────────────
  const renderSubUnitRegistration = () => {
    if (!canRegisterSubUnits || !currentOrg) return null;

    return (
      <Card className="border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/40 dark:to-emerald-900/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            USAJILI WA VITENGO
          </CardTitle>
          <CardDescription className="text-emerald-700 dark:text-emerald-400">
            Sajili {subUnitTypeLabelPlural.toLowerCase()} chini ya {currentOrg.name}. Kusajili vitengo kunawezesha ripoti za mkusanyiko (consolidation reports).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Registration form */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Label htmlFor="sub-unit-name" className="sr-only">
                Jina la {subUnitTypeLabel}
              </Label>
              <Input
                id="sub-unit-name"
                placeholder={`Ingiza jina la ${subUnitTypeLabel.toLowerCase()}...`}
                value={subUnitName}
                onChange={(e) => setSubUnitName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && subUnitName.trim()) {
                    handleRegisterSubUnit();
                  }
                }}
                className="border-emerald-300 bg-white dark:bg-emerald-950/40 focus:border-emerald-500 h-11"
                disabled={subUnitRegistering}
              />
            </div>
            <Button
              onClick={handleRegisterSubUnit}
              disabled={!subUnitName.trim() || subUnitRegistering}
              className="bg-emerald-600 hover:bg-emerald-700 text-white h-11 px-6"
            >
              {subUnitRegistering ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Sajili
            </Button>
          </div>

          {/* Sub-units list */}
          <div>
            <h4 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-2 flex items-center gap-1">
              <Users className="h-4 w-4" />
              {subUnitTypeLabelPlural} vilivyosajiliwa ({mySubUnits.length}):
            </h4>
            {mySubUnits.length === 0 ? (
              <div className="text-center py-6 text-emerald-600/60 dark:text-emerald-400/50 border border-dashed border-emerald-300 rounded-lg bg-white/40 dark:bg-emerald-950/20">
                <TreePine className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Hakuna {subUnitTypeLabelPlural.toLowerCase()} bado. Anza kusajili sasa!</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-x-auto bg-white dark:bg-emerald-950/30 max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                      <TableHead className="text-white font-semibold">Jina</TableHead>
                      <TableHead className="text-white font-semibold">Msimbo</TableHead>
                      <TableHead className="text-white font-semibold">Hali</TableHead>
                      <TableHead className="text-white font-semibold text-right">Vitendo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mySubUnits.map((unit) => (
                      <TableRow key={unit.id} className={!unit.isActive ? 'opacity-50' : ''}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Badge className={ORG_COLORS[unit.type]}>
                              {ORG_LABELS[unit.type]}
                            </Badge>
                            {unit.name}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {unit.code}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={unit.isActive ? 'default' : 'destructive'}
                            className={unit.isActive ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                          >
                            {unit.isActive ? 'Inayotumika' : 'Haitumiki'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                              onClick={() => handleEditSubUnit(unit)}
                              title="Hariri"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {unit.isActive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                                onClick={() => handleDeactivateSubUnit(unit)}
                                title="Sitisha"
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── Render org row recursively ─────────────────────────
  const renderOrgRow = (org: OrgUnit, depth: number = 0) => {
    const children = childrenMap[org.id!] || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(org.id!);
    const indent = depth * 32;

    return (
        <React.Fragment key={org.id}>
        <TableRow
          className={`cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors ${
            !org.isActive ? 'opacity-50' : ''
          } ${selectedOrg?.id === org.id ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''}`}
          onClick={() => setSelectedOrg(org)}
        >
          <TableCell className="w-10">
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(org.id!);
                }}
                className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-emerald-700" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-emerald-700" />
                )}
              </button>
            ) : (
              <span className="inline-block w-6" />
            )}
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
              <Badge className={ORG_COLORS[org.type]}>{ORG_LABELS[org.type]}</Badge>
              <span className="font-medium">{org.name}</span>
            </div>
          </TableCell>
          <TableCell className="text-muted-foreground font-mono text-sm">
            {org.code}
          </TableCell>
          <TableCell>
            <Badge variant="outline" className="text-xs">
              {ORG_LABELS[org.type]}
            </Badge>
          </TableCell>
          <TableCell className="text-center">
            {hasChildren ? (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                {children.length}
              </Badge>
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </TableCell>
          <TableCell>
            <Badge
              variant={org.isActive ? 'default' : 'destructive'}
              className={
                org.isActive
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : ''
              }
            >
              {org.isActive ? 'Inayotumika' : 'Haitumiki'}
            </Badge>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {org.type !== 'tawi' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50"
                  onClick={() => openAddDialog(org)}
                  title={`Ongeza ${getChildTypeLabel(org)}`}
                  disabled={
                    !currentOrg ||
                    (currentOrg.type === 'jimbo' && org.id !== currentOrg.id) ||
                    (currentOrg.type === 'markaz' && org.type !== 'markaz')
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                onClick={() => openEditDialog(org)}
                title="Hariri"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {org.isActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                  onClick={() => handleDeactivate(org)}
                  title="Sitisha"
                >
                  <Ban className="h-4 w-4" />
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && children.map((child) => renderOrgRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  // ── Selected org detail panel ─────────────────────────
  const renderDetailPanel = () => {
    if (!selectedOrg) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Building2 className="h-12 w-12 mb-3 opacity-40" />
          <p>Chagua kitengo kutoka orodha</p>
        </div>
      );
    }

    const children = childrenMap[selectedOrg.id!] || [];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Badge className={ORG_COLORS[selectedOrg.type]}>
                {ORG_LABELS[selectedOrg.type]}
              </Badge>
              {selectedOrg.name}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Msimbo: {selectedOrg.code} | Hali:{' '}
              {selectedOrg.isActive ? 'Inayotumika' : 'Haitumiki'}
            </p>
          </div>
          {selectedOrg.type !== 'tawi' && (
            <Button
              onClick={() => openAddDialog(selectedOrg)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="h-4 w-4 mr-1" />
              Ongeza {getChildTypeLabel(selectedOrg)}
            </Button>
          )}
        </div>

        {children.length > 0 && (
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                  <TableHead className="text-white font-semibold">
                    {selectedOrg.type === 'markaz' ? 'Majimbo' : 'Matawi'}
                  </TableHead>
                  <TableHead className="text-white font-semibold">Msimbo</TableHead>
                  <TableHead className="text-white font-semibold">Hali</TableHead>
                  <TableHead className="text-white font-semibold text-right">Vitengo vidogo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {children.map((child) => {
                  const grandChildren = childrenMap[child.id!] || [];
                  return (
                    <TableRow key={child.id} className={!child.isActive ? 'opacity-50' : ''}>
                      <TableCell className="font-medium">{child.name}</TableCell>
                      <TableCell className="font-mono text-sm">{child.code}</TableCell>
                      <TableCell>
                        <Badge
                          variant={child.isActive ? 'default' : 'destructive'}
                          className={
                            child.isActive ? 'bg-emerald-600 hover:bg-emerald-700' : ''
                          }
                        >
                          {child.isActive ? 'Inayotumika' : 'Haitumiki'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {child.type === 'jimbo' ? (
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                            {grandChildren.length} Matawi
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {children.length === 0 && selectedOrg.type !== 'tawi' && (
          <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/30">
            <TreePine className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>Hakuna {selectedOrg.type === 'markaz' ? 'majimbo' : 'matawi'} bado</p>
            <Button
              variant="outline"
              className="mt-3 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={() => openAddDialog(selectedOrg)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Ongeza {getChildTypeLabel(selectedOrg)}
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <TreePine className="h-6 w-6 text-emerald-600" />
            Muundo wa Taasisi
          </h2>
          <p className="text-muted-foreground mt-1">
            Simamia muundo wa Markaz Kuu, Majimbo, na Matawi
          </p>
        </div>
        <Button
          variant="outline"
          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          onClick={() => { loadOrgTree(); loadMySubUnits(); }}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Oanisha
        </Button>
      </div>

      {/* Sub-unit registration section (BEFORE the tree) */}
      {renderSubUnitRegistration()}

      {/* Org tree */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-emerald-800">Orodha ya Vitengo</CardTitle>
          <CardDescription>Bonyeza kivinjari kupanua/kunyima. Bonyeza kitengo kuchagua.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
              <span className="ml-2 text-muted-foreground">Inapakia...</span>
            </div>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-emerald-700 hover:bg-emerald-700">
                    <TableHead className="text-white font-semibold w-10" />
                    <TableHead className="text-white font-semibold">Jina</TableHead>
                    <TableHead className="text-white font-semibold">Msimbo</TableHead>
                    <TableHead className="text-white font-semibold">Aina</TableHead>
                    <TableHead className="text-white font-semibold text-center">Vidogo</TableHead>
                    <TableHead className="text-white font-semibold">Hali</TableHead>
                    <TableHead className="text-white font-semibold">Vitendo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgTree.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Hakuna vitengo vya taasisi bado
                      </TableCell>
                    </TableRow>
                  ) : (
                    orgTree.map((markaz) => renderOrgRow(markaz, 0))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-emerald-800">Maelezo ya Kitengo</CardTitle>
        </CardHeader>
        <CardContent>{renderDetailPanel()}</CardContent>
      </Card>

      {/* ── Add Org Dialog ─────────────────────────────── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-emerald-800">
              Ongeza {addParent ? getChildTypeLabel(addParent) : 'Kitengo'}
            </DialogTitle>
            <DialogDescription>
              {addParent
                ? `Kuongeza ${getChildTypeLabel(addParent).toLowerCase()} chini ya ${addParent.name}`
                : 'fomu ya kuongeza kitengo kipya'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="add-jina" className="text-sm font-medium">
                Jina (Name)
              </Label>
              <Input
                id="add-jina"
                placeholder="Ingiza jina la kitengo"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                className="border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-msimbo" className="text-sm font-medium">
                Msimbo (Code)
              </Label>
              <Input
                id="add-msimbo"
                placeholder="Ingiza msimbo wa kitengo"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.toUpperCase())}
                className="border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Aina (Type)</Label>
              <Input
                value={addParent ? getChildTypeLabel(addParent) : '—'}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Chini ya (Under)</Label>
              <Input
                value={addParent ? `${addParent.name} (${addParent.code})` : '—'}
                disabled
                className="bg-muted"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Ghairi</Button>
            </DialogClose>
            <Button
              onClick={handleAddOrg}
              disabled={!addName.trim() || !addCode.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="h-4 w-4 mr-1" />
              Ongeza
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Org Dialog ─────────────────────────────── */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-emerald-800">Hariri Kitengo</DialogTitle>
            <DialogDescription>Badilisha jina au msimbo wa kitengo</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-jina" className="text-sm font-medium">
                Jina (Name)
              </Label>
              <Input
                id="edit-jina"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-msimbo" className="text-sm font-medium">
                Msimbo (Code)
              </Label>
              <Input
                id="edit-msimbo"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                className="border-emerald-200 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Aina (Type)</Label>
              <Input
                value={editOrg ? ORG_LABELS[editOrg.type] : '—'}
                disabled
                className="bg-muted"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Ghairi</Button>
            </DialogClose>
            <Button
              onClick={handleEditOrg}
              disabled={!editName.trim() || !editCode.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Pencil className="h-4 w-4 mr-1" />
              Hifadhi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
