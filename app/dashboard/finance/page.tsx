"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Receipt, TrendingUp, TrendingDown, DollarSign, Plus, ArrowUpRight, ArrowDownLeft, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface Transaction {
  id: string
  date: string
  description: string
  type: "income" | "expense"
  category: string
  amount: number
  reference: string
}

// No hardcoded transactions — all entries are added manually by admin
const transactions: Transaction[] = []

export default function FinancePage() {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all")
  const [showAddForm, setShowAddForm] = useState(false)

  const filtered = transactions.filter((t) => {
    const matchSearch = t.description.toLowerCase().includes(search.toLowerCase()) || t.reference.toLowerCase().includes(search.toLowerCase())
    if (filter === "all") return matchSearch
    return matchSearch && t.type === filter
  })

  const totalIncome = transactions.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0)
  const totalExpense = transactions.filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0)
  const balance = totalIncome - totalExpense

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <Receipt className="size-8 text-green-600" /> Finance
        </h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300">Financial entries, income, and expenses overview.</p>
      </motion.div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
                <TrendingUp className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-navy-500 dark:text-navy-400">Total Income</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">AED {totalIncome.toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/20">
                <TrendingDown className="size-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-xs text-navy-500 dark:text-navy-400">Total Expenses</p>
                <p className="text-xl font-bold text-red-600 dark:text-red-400">AED {totalExpense.toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/20">
                <DollarSign className="size-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-navy-500 dark:text-navy-400">Net Balance</p>
                <p className={cn("text-xl font-bold", balance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                  AED {balance.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search transactions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          {(["all", "income", "expense"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}
              className={cn(filter === f && "bg-gold-500 text-navy-950 hover:bg-gold-400", "capitalize")}>
              {f}
            </Button>
          ))}
          <Button size="sm" className="bg-green-600 text-white hover:bg-green-500" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="size-4 mr-1" /> Add Entry
          </Button>
        </div>
      </div>

      {/* Transactions table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-navy-50 dark:bg-navy-800/50">
                  <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">Description</th>
                  <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">Category</th>
                  <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">Reference</th>
                  <th className="px-4 py-3 text-right font-medium text-navy-600 dark:text-navy-300">Amount (AED)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-navy-50/50 dark:hover:bg-navy-800/30">
                    <td className="px-4 py-3 text-navy-500 dark:text-navy-400 text-xs">{t.date}</td>
                    <td className="px-4 py-3 font-medium text-navy-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        {t.type === "income" ? (
                          <ArrowDownLeft className="size-4 text-emerald-500 shrink-0" />
                        ) : (
                          <ArrowUpRight className="size-4 text-red-500 shrink-0" />
                        )}
                        {t.description}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-navy-500 dark:text-navy-400">{t.category}</td>
                    <td className="px-4 py-3 text-navy-400 font-mono text-xs">{t.reference}</td>
                    <td className={cn("px-4 py-3 text-right font-semibold", t.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                      {t.type === "income" ? "+" : "-"}{t.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center">
          <Receipt className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
          <p className="text-navy-500 dark:text-navy-400">No transactions found.</p>
        </div>
      )}
    </div>
  )
}
