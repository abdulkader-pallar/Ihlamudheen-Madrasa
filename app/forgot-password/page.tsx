"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { motion } from "framer-motion"
import { Mail, Loader2, ArrowLeft, CheckCircle } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetError) {
        setError(resetError.message)
        toast.error(resetError.message)
        return
      }

      setSent(true)
      toast.success("Password reset email sent!")
    } catch {
      const message = "An unexpected error occurred. Please try again."
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-navy-950 p-6">
      {/* Background pattern */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-10">
        <div className="absolute top-20 left-10 w-72 h-72 rounded-full bg-gold-500 blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full bg-gold-400 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md space-y-8 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-8"
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={120} height={36} className="h-9 w-auto rounded" />
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold text-white tracking-tight">Ihlamudheen</span>
            <span className="text-[10px] font-medium text-navy-300 tracking-wide"></span>
          </div>
        </div>

        {sent ? (
          /* Success state */
          <div className="space-y-4 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500/20"
            >
              <CheckCircle className="size-8 text-emerald-400" />
            </motion.div>
            <h1 className="text-xl font-bold text-white">Check your email</h1>
            <p className="text-sm text-navy-300">
              We sent a password reset link to <span className="font-medium text-white">{email}</span>.
              Please check your inbox and follow the instructions.
            </p>
            <Link href="/login">
              <Button className="mt-4 w-full bg-gold-500 text-navy-950 hover:bg-gold-400 font-semibold">
                Back to Sign In
              </Button>
            </Link>
          </div>
        ) : (
          /* Form state */
          <>
            <div>
              <h1 className="text-xl font-bold text-white">Forgot your password?</h1>
              <p className="mt-2 text-sm text-navy-300">
                Enter your email address and we&apos;ll send you a link to reset your password.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-navy-200">Email address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-navy-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 h-10 bg-white/10 border-white/20 text-white placeholder:text-navy-400"
                    autoComplete="email"
                  />
                </div>
              </div>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-red-400 bg-red-950/30 rounded-lg px-3 py-2"
                >
                  {error}
                </motion.p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-gold-500 text-navy-950 hover:bg-gold-400 font-semibold text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>
            </form>

            <Link
              href="/login"
              className="flex items-center justify-center gap-2 text-sm text-navy-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="size-4" />
              Back to Sign In
            </Link>
          </>
        )}
      </motion.div>
    </div>
  )
}
