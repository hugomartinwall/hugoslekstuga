import type { Metadata } from "next";
import { Geist, Bricolage_Grotesque } from "next/font/google";
import Nav from "@/components/Nav";
import ConditionalFooter from "@/components/ConditionalFooter";
import { SearchPalette, SearchProvider } from "@/components/Search";
import "./globals.css";

const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

export const metadata: Metadata = {
  // Brand visual is the unspaced wordmark "hugoslekstuga"; the
  // searchable name is the spaced form "Hugos Lekstuga". Both
  // appear in titles/descriptions so Google matches either query.
  title: {
    default: "Hugos Lekstuga — a small playhouse of browser tools",
    template: "%s — Hugos Lekstuga",
  },
  description:
    "Hugos Lekstuga (Swedish for Hugo's playground) — a small playhouse of useful, playful browser tools by Hugo Martin Wall. Everything runs in your tab; no accounts, no uploads, no analytics.",
  metadataBase: new URL("https://hugoslekstuga.com"),
  alternates: {
    canonical: "https://hugoslekstuga.com",
  },
  keywords: [
    "Hugos Lekstuga",
    "hugoslekstuga",
    "hugo lekstuga",
    "hugo's playground",
    "Hugo Martin Wall",
    "browser tools",
    "free online tools",
    "no upload tools",
    "privacy-friendly tools",
    "playhouse",
  ],
  authors: [{ name: "Hugo Martin Wall", url: "https://oogywawa.se" }],
  creator: "Hugo Martin Wall",
  publisher: "Hugo Martin Wall",
  openGraph: {
    title: "Hugos Lekstuga — a small playhouse of browser tools",
    description:
      "Hugos Lekstuga — a small playhouse of useful, playful browser tools by Hugo Martin Wall. Runs in your tab, leaves no trace.",
    url: "https://hugoslekstuga.com",
    siteName: "Hugos Lekstuga",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hugos Lekstuga",
    description:
      "A small playhouse of useful browser tools. No accounts, no uploads, no analytics.",
  },
};

/**
 * Structured data — JSON-LD for the WebSite and the Person who runs
 * it. Lets Google attach the entity "Hugos Lekstuga" to its rich-card
 * understanding of the site and disambiguates the brand against the
 * unspaced wordmark.
 */
const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://hugoslekstuga.com/#website",
      name: "Hugos Lekstuga",
      alternateName: ["hugoslekstuga", "Hugo's Lekstuga", "Hugo's Playground"],
      url: "https://hugoslekstuga.com",
      description:
        "A small playhouse of useful, playful browser tools. No accounts, no uploads, no analytics.",
      inLanguage: "en",
      publisher: { "@id": "https://hugoslekstuga.com/#person" },
    },
    {
      "@type": "Person",
      "@id": "https://hugoslekstuga.com/#person",
      name: "Hugo Martin Wall",
      url: "https://oogywawa.se",
      sameAs: ["https://oogywawa.se", "https://hugoslekstuga.com"],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-ink">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
        />
        <SearchProvider>
          <Nav />
          <div className="flex-1">{children}</div>
          <ConditionalFooter />
          <SearchPalette />
        </SearchProvider>
      </body>
    </html>
  );
}
