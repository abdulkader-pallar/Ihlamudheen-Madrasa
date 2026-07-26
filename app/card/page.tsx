import ContactCard from "@/components/ContactCard"

export const metadata = {
  title: "Ihlamudheen Madrasa | Digital Card",
  description:
    "Connect with Ihlamudheen Madrasa — Ihlamudheen Madrasa. Call, WhatsApp, save our contact, find us on the map and on social media.",
  openGraph: {
    title: "Ihlamudheen Madrasa | Digital Card",
    description:
      "Call, WhatsApp, save our contact and find Ihlamudheen Madrasa — Ihlamudheen Madrasa, Malappuram, Kerala.",
    images: ["/logo.png"],
  },
}

export default function Page() {
  return <ContactCard />
}
