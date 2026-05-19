'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ExpenseForm from './ExpenseForm';
import TransactionList from './TransactionList';
import CategoryManager from './CategoryManager';
import { MinusCircle, List, Tag } from 'lucide-react';

export default function ExpensePage() {
  return (
    <div className="space-y-0">
      <Tabs defaultValue="form" className="w-full">
        <TabsList className="mb-4 bg-orange-100/60 w-full flex flex-wrap h-auto gap-1">
          <TabsTrigger
            value="form"
            className="data-[state=active]:bg-orange-600 data-[state=active]:text-white gap-1.5 flex-1 min-w-0"
          >
            <MinusCircle className="size-4 shrink-0" />
            <span className="truncate">Ingiza Matumizi</span>
          </TabsTrigger>
          <TabsTrigger
            value="list"
            className="data-[state=active]:bg-orange-600 data-[state=active]:text-white gap-1.5 flex-1 min-w-0"
          >
            <List className="size-4 shrink-0" />
            <span className="truncate">Orodha ya Matumizi</span>
          </TabsTrigger>
          <TabsTrigger
            value="categories"
            className="data-[state=active]:bg-orange-600 data-[state=active]:text-white gap-1.5 flex-1 min-w-0"
          >
            <Tag className="size-4 shrink-0" />
            <span className="truncate">Makundi</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form">
          <ExpenseForm />
        </TabsContent>

        <TabsContent value="list">
          <TransactionList initialType="expense" />
        </TabsContent>

        <TabsContent value="categories">
          <CategoryManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
