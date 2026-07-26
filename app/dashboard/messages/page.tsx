"use client"

// ============================================================
// Fix 1: src/app/dashboard/messages/page.tsx
// Drop-in replacement — proper modal + Supabase persistence
// ============================================================

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, Send, Plus, MessageSquare, X, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────
interface LocalThread {
  threadId: string
  otherName: string
  otherRole: string
  lastMessage: string
  lastTime: string
  unread: boolean
}

interface LocalMessage {
  id: string
  senderId: string
  senderName: string
  text: string
  createdAt: string
}

// ── New Conversation Modal ────────────────────────────────
function NewConversationModal({
  onClose,
  onStart,
}: {
  onClose: () => void
  onStart: (name: string, role: string) => void
}) {
  const [name, setName] = useState("")
  const [role, setRole] = useState("Teacher")
  const roles = ["Teacher", "Student", "Staff", "Admin", "Parent"]
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onStart(name.trim(), role)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-sm bg-white dark:bg-navy-800 rounded-2xl shadow-2xl border border-border/60 p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-navy-900 dark:text-white">New Message</h2>
          <button
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full hover:bg-navy-100 dark:hover:bg-navy-700 transition-colors"
          >
            <X className="size-4 text-navy-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-navy-600 dark:text-navy-300 mb-1.5">
              Recipient name
            </label>
            <Input
              ref={inputRef}
              placeholder="e.g. Ms. Fatima Al Hassan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy-600 dark:text-navy-300 mb-1.5">
              Their role
            </label>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                    role === r
                      ? "bg-gold-500 border-gold-500 text-navy-950"
                      : "bg-transparent border-border text-navy-600 dark:text-navy-300 hover:border-gold-400"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            disabled={!name.trim()}
            className="w-full bg-gold-500 text-navy-950 hover:bg-gold-400 font-semibold"
          >
            Start Conversation
          </Button>
        </form>
      </motion.div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────
export default function MessagesPage() {
  const { user } = useAuth(true)
  const myId = user?.id || "local"
  const myName = user?.user_metadata?.full_name || user?.email || "Me"
  const myRole = getUserRole(user)

  // Threads + messages state
  const [threads, setThreads] = useState<LocalThread[]>([])
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [newMessage, setNewMessage] = useState("")
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [supabaseReady, setSupabaseReady] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // ── Load threads from Supabase ─────────────────────────
  const loadThreads = useCallback(async () => {
    const ready = await db.checkSupabase()
    if (!ready) { setLoading(false); return }
    setSupabaseReady(true)
    const data = await db.fetchChatThreads(myId)
    setThreads(data)
    setLoading(false)
  }, [myId])

  // ── Load messages for selected thread ─────────────────
  const loadMessages = useCallback(async (threadId: string) => {
    if (!supabaseReady) return
    const data = await db.fetchChatMessages(threadId)
    setMessages(data.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.senderName,
      text: m.text,
      createdAt: m.createdAt,
    })))
  }, [supabaseReady])

  useEffect(() => { loadThreads() }, [loadThreads])

  useEffect(() => {
    if (!selectedThreadId) return
    loadMessages(selectedThreadId)
  }, [selectedThreadId, loadMessages])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Real-time subscription for the selected thread
  useEffect(() => {
    if (!supabaseReady || !selectedThreadId) return
    const sub = db.subscribeToTable(
      "chat_messages",
      () => { loadMessages(selectedThreadId); loadThreads() },
      `thread_id=eq.${selectedThreadId}`
    )
    return () => sub.unsubscribe()
  }, [supabaseReady, selectedThreadId, loadMessages, loadThreads])

  // ── Start a new conversation ───────────────────────────
  const handleStartConversation = (otherName: string, otherRole: string) => {
    // Build a synthetic thread ID using name-based key (since we don't know their UID)
    const syntheticOtherId = `user_${otherName.toLowerCase().replace(/\s+/g, "_")}`
    const threadId = db.buildThreadId(myId, syntheticOtherId)

    // Add to local thread list if not already there
    setThreads((prev) => {
      if (prev.some((t) => t.threadId === threadId)) return prev
      return [
        {
          threadId,
          otherName,
          otherRole,
          lastMessage: "",
          lastTime: new Date().toISOString(),
          unread: false,
        },
        ...prev,
      ]
    })
    setSelectedThreadId(threadId)
    setMessages([])
  }

  // ── Send a message ─────────────────────────────────────
  const handleSend = async () => {
    const text = newMessage.trim()
    if (!text || !selectedThreadId) return

    setNewMessage("")
    setSending(true)

    // Optimistic update
    const optimistic: LocalMessage = {
      id: `opt_${Date.now()}`,
      senderId: myId,
      senderName: myName,
      text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    if (supabaseReady) {
      const { error } = await db.sendChatMessage({
        threadId: selectedThreadId,
        senderId: myId,
        senderName: myName,
        senderRole: myRole,
        text,
      })
      if (error) {
        toast.error("Failed to send message")
        // Remove optimistic on failure
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      } else {
        // Update thread list
        setThreads((prev) =>
          prev.map((t) =>
            t.threadId === selectedThreadId
              ? { ...t, lastMessage: text, lastTime: new Date().toISOString() }
              : t
          )
        )
      }
    }

    setSending(false)
  }

  // ── Derived ────────────────────────────────────────────
  const filteredThreads = useMemo(
    () => threads.filter((t) => t.otherName.toLowerCase().includes(search.toLowerCase())),
    [threads, search]
  )

  const selectedThread = useMemo(
    () => threads.find((t) => t.threadId === selectedThreadId) || null,
    [threads, selectedThreadId]
  )

  // ── Helpers ────────────────────────────────────────────
  function formatTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <>
      <AnimatePresence>
        {showModal && (
          <NewConversationModal
            onClose={() => setShowModal(false)}
            onStart={handleStartConversation}
          />
        )}
      </AnimatePresence>

      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between gap-3"
        >
          <div>
            <h1 className="text-3xl font-bold text-navy-900 dark:text-white">Messages</h1>
            <p className="mt-1 text-navy-600 dark:text-navy-300">
              Chat with teachers, staff, and classmates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {supabaseReady ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            ) : (
              <span className="text-xs text-amber-500">Local only</span>
            )}
            <Button
              onClick={() => setShowModal(true)}
              className="bg-gold-500 text-navy-950 hover:bg-gold-400 shrink-0"
            >
              <Plus className="size-4 mr-1" /> New
            </Button>
          </div>
        </motion.div>

        <Card className="overflow-hidden">
          <div className="flex h-[600px]">
            {/* ── Thread list ── */}
            <div className="w-80 border-r border-border/50 flex flex-col shrink-0">
              <div className="p-3 border-b border-border/50">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search messages..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="size-5 animate-spin text-navy-400" />
                  </div>
                ) : filteredThreads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center p-6 h-full gap-2">
                    <MessageSquare className="size-8 text-navy-300 dark:text-navy-600" />
                    <p className="text-sm text-navy-500 dark:text-navy-400">
                      {threads.length === 0 ? "No conversations yet." : "No matches."}
                    </p>
                    {threads.length === 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowModal(true)}
                        className="mt-1"
                      >
                        <Plus className="size-3.5 mr-1" /> Start one
                      </Button>
                    )}
                  </div>
                ) : (
                  filteredThreads.map((thread) => (
                    <button
                      key={thread.threadId}
                      onClick={() => setSelectedThreadId(thread.threadId)}
                      className={cn(
                        "flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-navy-50 dark:hover:bg-navy-800/50",
                        selectedThreadId === thread.threadId && "bg-navy-50 dark:bg-navy-800/50"
                      )}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-500 text-sm font-semibold text-white">
                        {thread.otherName[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className={cn(
                            "text-sm truncate",
                            thread.unread ? "font-bold text-navy-900 dark:text-white" : "font-medium text-navy-800 dark:text-white"
                          )}>
                            {thread.otherName}
                          </span>
                          <span className="text-[10px] text-navy-400 shrink-0">
                            {thread.lastTime ? formatTime(thread.lastTime) : ""}
                          </span>
                        </div>
                        <p className="text-xs text-navy-500 dark:text-navy-400 mt-0.5 flex items-center gap-1">
                          <span className="text-[10px] bg-navy-100 dark:bg-navy-700 text-navy-500 dark:text-navy-300 px-1.5 rounded-full">{thread.otherRole}</span>
                          <span className="truncate">{thread.lastMessage || "No messages yet"}</span>
                        </p>
                      </div>
                      {thread.unread && (
                        <span className="size-2 rounded-full bg-gold-500 mt-1.5 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* ── Chat area ── */}
            <div className="flex flex-1 flex-col min-w-0">
              {selectedThread ? (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-3 border-b border-border/50 p-4 shrink-0">
                    <div className="flex size-9 items-center justify-center rounded-full bg-gold-500 text-sm font-semibold text-white shrink-0">
                      {selectedThread.otherName[0]?.toUpperCase() || "?"}
                    </div>
                    <div>
                      <p className="font-semibold text-navy-900 dark:text-white">
                        {selectedThread.otherName}
                      </p>
                      <p className="text-xs text-navy-400">{selectedThread.otherRole}</p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-navy-400">
                        <MessageSquare className="size-6" />
                        <p className="text-sm">No messages yet — say hi.</p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isMe = msg.senderId === myId
                        return (
                          <div
                            key={msg.id}
                            className={cn("flex", isMe ? "justify-end" : "justify-start")}
                          >
                            <div
                              className={cn(
                                "max-w-[70%] rounded-2xl px-4 py-2.5",
                                isMe
                                  ? "bg-gold-500 text-navy-950"
                                  : "bg-navy-100 text-navy-900 dark:bg-navy-700 dark:text-white"
                              )}
                            >
                              {!isMe && (
                                <p className="text-[10px] font-semibold mb-1 opacity-60">
                                  {msg.senderName}
                                </p>
                              )}
                              <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                              <p className={cn(
                                "text-[10px] mt-1 text-right",
                                isMe ? "text-navy-700" : "text-navy-400"
                              )}>
                                {formatTime(msg.createdAt)}
                              </p>
                            </div>
                          </div>
                        )
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input */}
                  <div className="border-t border-border/50 p-3 shrink-0">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type a message..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        className="flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            handleSend()
                          }
                        }}
                      />
                      <Button
                        className="bg-gold-500 text-navy-950 hover:bg-gold-400 shrink-0"
                        onClick={handleSend}
                        disabled={!newMessage.trim() || sending}
                      >
                        {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center text-center gap-3 p-8">
                  <MessageSquare className="size-10 text-navy-300 dark:text-navy-600" />
                  <div>
                    <p className="font-medium text-navy-800 dark:text-white">
                      No conversation selected
                    </p>
                    <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
                      Pick one on the left, or start a new message.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setShowModal(true)}>
                    <Plus className="size-4 mr-1" /> New message
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
