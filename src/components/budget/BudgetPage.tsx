'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BudgetForm from './BudgetForm';
import BudgetList from './BudgetList';
import BudgetAnalysis from './BudgetAnalysis';
import { PlusCircle, List, BarChart3 } from 'lucide-react';

export default function BudgetPage() {
  const [activeTab, setActiveTab] = useState('form');
  const [editingBudgetId, setEditingBudgetId] = useState<number | null>(null);
  const [analysisBudgetId, setAnalysisBudgetId] = useState<number | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleEdit = (budgetId: number) => {
    setEditingBudgetId(budgetId);
    setActiveTab('form');
  };

  const handleViewAnalysis = (budgetId: number) => {
    setAnalysisBudgetId(budgetId);
    setActiveTab('analysis');
  };

  const handleSaved = () => {
    setEditingBudgetId(null);
    setActiveTab('list');
    setRefreshTrigger(prev => prev + 1);
  };

  const handleCancel = () => {
    setEditingBudgetId(null);
    setActiveTab('list');
  };

  return (
    <div className="space-y-0">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 bg-teal-100/60">
          <TabsTrigger
            value="form"
            className="data-[state=active]:bg-teal-600 data-[state=active]:text-white gap-1.5"
          >
            <PlusCircle className="size-4" />
            {editingBudgetId ? 'Hariri Bajeti' : 'Unda Bajeti'}
          </TabsTrigger>
          <TabsTrigger
            value="list"
            className="data-[state=active]:bg-teal-600 data-[state=active]:text-white gap-1.5"
          >
            <List className="size-4" />
            Orodha ya Bajeti
          </TabsTrigger>
          <TabsTrigger
            value="analysis"
            className="data-[state=active]:bg-teal-600 data-[state=active]:text-white gap-1.5"
          >
            <BarChart3 className="size-4" />
            Uchambuzi
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form">
          <BudgetForm
            editingBudgetId={editingBudgetId}
            onSaved={handleSaved}
            onCancel={editingBudgetId ? handleCancel : undefined}
          />
        </TabsContent>

        <TabsContent value="list">
          <BudgetList
            onEdit={handleEdit}
            onViewAnalysis={handleViewAnalysis}
            refreshTrigger={refreshTrigger}
          />
        </TabsContent>

        <TabsContent value="analysis">
          <BudgetAnalysis
            budgetId={analysisBudgetId}
            onBack={() => setActiveTab('list')}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
