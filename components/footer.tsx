import Link from "next/link"
import Image from "next/image"
import {
  Mail,
  Phone,
  MapPin,
  Globe,
  MessageCircle,
} from "lucide-react"
const quickLinks = [
  { href: "/courses", label: "Browse Courses" },
  { href: "/#about", label: "About Ihlamudheen" },
  { href: "/dashboard", label: "Student Dashboard" },
  { href: "/login", label: "Sign In" },
]

const programs = [
  { href: "/courses/1", label: "Ihlamudheen Madrasa" },
  { href: "/courses/2", label: "English Madrasa" },
  { href: "/courses/3", label: "CIBIS Certification" },
  { href: "/courses/4", label: "Training Institute" },
]

const socials = [
  { href: "#", icon: Globe, label: "Website" },
  { href: "#", icon: MessageCircle, label: "WhatsApp" },
]

export function Footer() {
  return (
    <footer id="contact" className="border-t border-navy-800 bg-navy-900 text-navy-200 dark:bg-navy-950">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* About */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Image src="/logo-icon.png" alt="Ihlamudheen" width={36} height={36} className="size-9" />
              <div className="flex flex-col leading-none">
                <span className="text-lg font-bold text-white">Ihlamudheen</span>
                <span className="text-[10px] font-medium text-navy-400 tracking-wide"></span>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-navy-300">
              Ihlamudheen Madrasa provides Islamic and professional
              education to students in Malappuram, Kerala. Our programs
              include Madrasa, English Madrasa, CIBIS, and Teacher Training.
            </p>
            <div className="flex items-center gap-4 pt-2">
              <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={48} height={48} className="size-12 rounded-full" />
              <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={120} height={40} className="h-8 w-auto rounded" />
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
              Quick Links
            </h3>
            <ul className="space-y-2.5">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-navy-300 transition-colors hover:text-gold-400"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Programs */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
              Our Programs
            </h3>
            <ul className="space-y-2.5">
              {programs.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-navy-300 transition-colors hover:text-gold-400"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
              Contact Us
            </h3>
            <ul className="space-y-2.5">
              <li className="flex items-start gap-2 text-sm text-navy-300">
                <MapPin className="mt-0.5 size-4 shrink-0 text-gold-500" />
                Town Centre, Malappuram, Kerala
              </li>
              <li className="flex items-center gap-2 text-sm text-navy-300">
                <Mail className="size-4 shrink-0 text-gold-500" />
                info@example.com
              </li>
              <li className="flex items-center gap-2 text-sm text-navy-300">
                <Phone className="size-4 shrink-0 text-gold-500" />
                +91 00000 00000
              </li>
            </ul>
          </div>
        </div>

        {/* Social icons */}
        <div className="mt-10 flex items-center justify-center gap-4 border-t border-navy-800 pt-8">
          {socials.map((social) => {
            const Icon = social.icon
            return (
              <Link
                key={social.label}
                href={social.href}
                aria-label={social.label}
                className="flex size-9 items-center justify-center rounded-full bg-navy-800 text-navy-300 transition-colors hover:bg-gold-500 hover:text-white btn-3d glow-icon"
              >
                <Icon className="size-4" />
              </Link>
            )
          })}
        </div>

        {/* Copyright + Privacy */}
        <div className="mt-6 flex flex-col items-center gap-1">
          <p className="text-center text-xs text-navy-400">
            &copy; {new Date().getFullYear()} Ihlamudheen Madrasa. All rights reserved.
          </p>
          <Link href="/privacy" className="text-xs text-navy-500 hover:text-gold-400 transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  )
}
