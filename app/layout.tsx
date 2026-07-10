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

const SITE_NAME = "Ihlamudheen Madrasa";
const SITE_URL = "https://ihlamudheen-madrasa.vercel.app";
const SITE_DESC =
  "Ihlamudheen Madrasa (Ilamudheen / Ilamuddeen Madrasa) — مدرسة إعلام الدين — in Pallar, Vairamkode, Malappuram, Kerala (PIN 676301). Trusted Islamic education since 1954: Qur'an, Hifz, Arabic & Islamic studies for children in Pallar Madrasa.";

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: "Ihlamudheen Madrasa",
  alternateName: ["Ilamudheen Madrasa", "Ilamuddeen Madrasa", "Pallar Madrasa", "مدرسة إعلام الدين"],
  url: SITE_URL,
  logo: `${SITE_URL}/Logo of Ihlamudheen Madrasa light.png`,
  foundingDate: "1954",
  description: SITE_DESC,
  address: {
    "@type": "PostalAddress",
    streetAddress: "Pallar, Vairamkode",
    addressLocality: "Pallar",
    addressRegion: "Kerala",
    postalCode: "676301",
    addressCountry: "IN",
  },
  geo: {
    "@type": "GeoCoordinates",
    addressCountry: "IN",
  },
  areaServed: ["Pallar", "Vairamkode", "Malappuram", "Kerala"],
  keywords:
    "Ihlamudheen Madrasa, Ilamudheen Madrasa, Ilamuddeen Madrasa, Pallar Madrasa, Pallar Islamic school, Vairamkode Madrasa, Malappuram Madrasa, Kerala Madrasa, Islamic education Kerala, Quran school Pallar, hifz Pallar",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Ihlamudheen Madrasa — Pallar, Malappuram, Kerala | مدرسة إعلام الدين",
    template: "%s | Ihlamudheen Madrasa",
  },
  description: SITE_DESC,
  keywords: [
    "Ihlamudheen Madrasa", "Ilamudheen Madrasa", "Ilamuddeen Madrasa",
    "Pallar Madrasa", "Pallar Islamic school", "Vairamkode Madrasa",
    "Malappuram Madrasa", "Kerala Madrasa", "Islamic education Kerala",
    "Quran school Pallar", "hifz Pallar", "madrasa Pallar 676301",
    "مدرسة إعلام الدين", "pallar", "vairamkode", "malappuram",
  ],
  openGraph: {
    title: "Ihlamudheen Madrasa — Pallar, Malappuram, Kerala",
    description: SITE_DESC,
    siteName: SITE_NAME,
    type: "website",
    url: SITE_URL,
    locale: "en_IN",
    images: [{ url: "/Logo of Ihlamudheen Madrasa light.png", alt: "Ihlamudheen Madrasa" }],
  },
  twitter: { card: "summary", title: "Ihlamudheen Madrasa — Pallar, Kerala", description: SITE_DESC },
  alternates: { canonical: SITE_URL },
};

// Apply the saved theme before paint to avoid a flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
