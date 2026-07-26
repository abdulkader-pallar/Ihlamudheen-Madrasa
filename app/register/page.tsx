"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import Image from "next/image";
import {
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Lock,
  User,
  GraduationCap,
  BookOpen,
  CheckCircle,
  ShieldAlert,
  Phone,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { getUserRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const features = [
  "4 free programs — Madrasa, English, CIBIS, Training",
  "Face-to-face classes at our campus",
  "Live online sessions available",
  "20+ certified and experienced teachers",
  "Track your learning progress online",
  "Registered educational institution",
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0 },
};

export default function RegisterPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth(false);
  const isAdmin = user ? getUserRole(user) === "admin" : false;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"student" | "instructor" | "">("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Show loading while auth resolves — never flash the form
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950">
        <Loader2 className="h-8 w-8 animate-spin text-gold-400" />
      </div>
    );
  }

  // Block non-admin users — show "Contact Ihlamudheen Madrasa Office" message
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-2xl border border-navy-700 bg-navy-900 p-8 text-center shadow-2xl"
        >
          <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-gold-500/10">
            <ShieldAlert className="size-8 text-gold-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Registration Restricted</h1>
          <p className="text-navy-300 mb-6">
            Account creation is managed by the administration. Please contact the Ihlamudheen Madrasa Office to register.
          </p>
          <div className="rounded-xl border border-navy-700 bg-navy-800/50 p-4 mb-6">
            <p className="text-sm font-semibold text-white mb-1">Ihlamudheen Madrasa</p>
            <p className="text-xs text-navy-400 mb-3">Malappuram, Kerala</p>
            <div className="flex items-center justify-center gap-2 text-sm text-gold-400">
              <Phone className="size-4" />
              <span>Contact the office for enrollment</span>
            </div>
          </div>
          <Link href="/login">
            <Button className="w-full bg-gold-500 text-navy-900 hover:bg-gold-400 font-semibold">
              Go to Sign In
            </Button>
          </Link>
        </motion.div>
      </div>
    );
  }

  const validateForm = (): boolean => {
    if (!fullName.trim()) {
      const msg = "Please enter your full name.";
      setError(msg);
      toast.error(msg);
      return false;
    }

    if (!email.trim()) {
      const msg = "Please enter your email address.";
      setError(msg);
      toast.error(msg);
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const msg = "Please enter a valid email address.";
      setError(msg);
      toast.error(msg);
      return false;
    }

    if (password.length < 6) {
      const msg = "Password must be at least 6 characters.";
      setError(msg);
      toast.error(msg);
      return false;
    }

    if (password !== confirmPassword) {
      const msg = "Passwords do not match.";
      setError(msg);
      toast.error(msg);
      return false;
    }

    if (!role) {
      const msg = "Please select a role.";
      setError(msg);
      toast.error(msg);
      return false;
    }

    if (!agreeTerms) {
      const msg = "You must agree to the terms and conditions.";
      setError(msg);
      toast.error(msg);
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) return;

    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role,
          },
        },
      });

      if (authError) {
        setError(authError.message);
        toast.error(authError.message);
        return;
      }

      toast.success("Account created! Please check your email to verify.");
      router.push("/login");
    } catch {
      const message = "An unexpected error occurred. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left Decorative Panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-navy-950">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-20 w-80 h-80 rounded-full bg-gold-500 blur-3xl" />
          <div className="absolute bottom-32 left-10 w-64 h-64 rounded-full bg-gold-400 blur-3xl" />
          <div className="absolute top-1/3 right-1/4 w-40 h-40 rounded-full bg-navy-400 blur-2xl" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Branding */}
          <div>
            <Link href="/" className="flex items-center gap-4">
              <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={56} height={56} className="size-14 rounded-full ring-2 ring-gold-500/30" />
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white tracking-tight">
                  Ihlamudheen
                </span>
                <span className="text-xs font-medium text-navy-300 tracking-wider">
                  
                </span>
              </div>
            </Link>
            <h2 className="mt-8 text-3xl font-bold text-white leading-tight">
              Start your learning
              <br />
              journey today
            </h2>
            <p className="mt-3 text-navy-200 max-w-sm">
              Join our community of learners at Ihlamudheen Madrasa —
              Islamic and professional education in one campus.
            </p>
            <div className="mt-4">
              <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={180} height={50} className="h-10 w-auto rounded" />
            </div>
          </div>

          {/* Features List */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="space-y-4"
          >
            {features.map((feature, index) => (
              <motion.div
                key={index}
                variants={itemVariants}
                className="flex items-center gap-3"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-500/20">
                  <CheckCircle className="h-4 w-4 text-gold-400" />
                </div>
                <span className="text-sm text-navy-100">{feature}</span>
              </motion.div>
            ))}
          </motion.div>

          {/* Bottom trust signal */}
          <div className="flex items-center gap-2 text-sm text-navy-300">
            <Lock className="h-4 w-4" />
            <span>Your data is protected with enterprise-grade security</span>
          </div>
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 sm:p-12 bg-background">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="w-full max-w-md space-y-6"
        >
          {/* Mobile Branding */}
          <motion.div variants={itemVariants} className="lg:hidden flex items-center gap-3 mb-4">
            <Image src="/logo-icon.png" alt="Ihlamudheen" width={36} height={36} className="size-9" />
            <div className="flex flex-col leading-none">
              <span className="text-lg font-bold text-foreground tracking-tight">Ihlamudheen</span>
              <span className="text-[10px] font-medium text-muted-foreground tracking-wide"></span>
            </div>
          </motion.div>

          {/* Header */}
          <motion.div variants={itemVariants}>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Create your account
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Get started with Ihlamudheen in just a few steps
            </p>
          </motion.div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <motion.div variants={itemVariants} className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="fullName"
                  type="text"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="pl-10 h-10"
                  autoComplete="name"
                />
              </div>
            </motion.div>

            {/* Email */}
            <motion.div variants={itemVariants} className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10 h-10"
                  autoComplete="email"
                />
              </div>
            </motion.div>

            {/* Password */}
            <motion.div variants={itemVariants} className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-10 pr-10 h-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </motion.div>

            {/* Confirm Password */}
            <motion.div variants={itemVariants} className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="pl-10 pr-10 h-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={
                    showConfirmPassword ? "Hide password" : "Show password"
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </motion.div>

            {/* Role Selection */}
            <motion.div variants={itemVariants} className="space-y-2">
              <Label>I want to join as</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRole("student")}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all",
                    role === "student"
                      ? "border-gold-500 bg-gold-50 dark:bg-gold-950/20"
                      : "border-border hover:border-navy-300 dark:hover:border-navy-600"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                      role === "student"
                        ? "bg-gold-500 text-navy-950"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      role === "student"
                        ? "text-gold-700 dark:text-gold-400"
                        : "text-foreground"
                    )}
                  >
                    Student
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setRole("instructor")}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all",
                    role === "instructor"
                      ? "border-gold-500 bg-gold-50 dark:bg-gold-950/20"
                      : "border-border hover:border-navy-300 dark:hover:border-navy-600"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                      role === "instructor"
                        ? "bg-gold-500 text-navy-950"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      role === "instructor"
                        ? "text-gold-700 dark:text-gold-400"
                        : "text-foreground"
                    )}
                  >
                    Instructor
                  </span>
                </button>
              </div>
            </motion.div>

            {/* Terms & Conditions */}
            <motion.div variants={itemVariants}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-navy-300 text-gold-500 focus:ring-gold-500 accent-gold-500"
                />
                <span className="text-sm text-muted-foreground">
                  I agree to the{" "}
                  <Link
                    href="/terms"
                    className="font-medium text-gold-600 hover:text-gold-500 underline underline-offset-2"
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy"
                    className="font-medium text-gold-600 hover:text-gold-500 underline underline-offset-2"
                  >
                    Privacy Policy
                  </Link>
                </span>
              </label>
            </motion.div>

            {/* Error message */}
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2"
              >
                {error}
              </motion.p>
            )}

            {/* Submit Button */}
            <motion.div variants={itemVariants}>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-gold-500 text-navy-950 hover:bg-gold-400 font-semibold text-sm transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating account...
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </motion.div>
          </form>

          {/* Login link */}
          <motion.p
            variants={itemVariants}
            className="text-center text-sm text-muted-foreground"
          >
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-gold-600 hover:text-gold-500 transition-colors"
            >
              Sign in
            </Link>
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
