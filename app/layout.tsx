import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});

const SITE_DESC =
  "Ihlamudheen Madrasa (مدرسة إعلام الدين) — nurturing faith, character and knowledge through Qur'an, Islamic studies and Arabic education since 1954.";

export const metadata: Metadata = {
  metadataBase: new URL("https://ihlamudheen-madrasa.vercel.app"),
  title: "Ihlamudheen Madrasa — مدرسة إعلام الدين",
  description: SITE_DESC,
  icons: { icon: "/Logo of Ihlamudheen Madrasa dark-bg removed.png" },
  openGraph: {
    title: "Ihlamudheen Madrasa — مدرسة إعلام الدين",
    description: SITE_DESC,
    siteName: "Ihlamudheen Madrasa",
    type: "website",
    images: [{ url: "/Logo of Ihlamudheen Madrasa light.png", alt: "Ihlamudheen Madrasa" }],
  },
  twitter: { card: "summary", title: "Ihlamudheen Madrasa", description: SITE_DESC },
};

// Apply the saved theme before paint to avoid a flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
