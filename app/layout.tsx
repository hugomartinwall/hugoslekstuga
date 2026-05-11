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

/** Tagline reused across all description fields and the JSON-LD —
 *  the same sentence the /about hero leads with, so the brand voice
 *  matches whether you arrive via search, share preview, or the
 *  about page itself. */
const TAGLINE =
  "Hugo spends the off-hours on experiments that occasionally turn into something worth sharing.";

export const metadata: Metadata = {
  // Brand visual is the unspaced wordmark "hugoslekstuga"; the
  // searchable name is the spaced form "Hugos Lekstuga". Both
  // appear in titles/descriptions so Google matches either query.
  title: {
    default: "Hugos Lekstuga (Hugos Playhouse)",
    template: "%s — Hugos Lekstuga",
  },
  description: TAGLINE,
  metadataBase: new URL("https://hugoslekstuga.com"),
  alternates: {
    canonical: "https://hugoslekstuga.com",
  },
  keywords: [
    "Hugos Lekstuga",
    "hugoslekstuga",
    "hugo lekstuga",
    "hugo's playground",
    "browser tools",
    "free online tools",
    "no upload tools",
    "privacy-friendly tools",
    "playhouse",
  ],
  authors: [{ name: "Hugo", url: "https://oogywawa.se" }],
  creator: "Hugo",
  publisher: "Hugo",
  openGraph: {
    title: "Hugos Lekstuga (Hugos Playhouse)",
    description: TAGLINE,
    url: "https://hugoslekstuga.com",
    siteName: "Hugos Lekstuga",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hugos Lekstuga",
    description: TAGLINE,
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
      name: "Hugo",
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
