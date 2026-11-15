import type { Metadata } from "next";
import { Chivo_Mono, Jersey_15, Silkscreen } from "next/font/google";
import BrandCorner from "@/components/BrandCorner";
import ConditionalFooter from "@/components/ConditionalFooter";
import { SearchPalette, SearchProvider } from "@/components/Search";
import TravelingDot from "@/components/TravelingDot";
import {
  SITE_OPEN_GRAPH,
  SITE_TAGLINE,
  SITE_TITLE,
  SITE_TWITTER,
  SITE_URL,
  TITLE_TEMPLATE,
} from "@/lib/site";
import "./globals.css";

/* Nattöppet type: Jersey 15 does the shouting (big display only),
   Silkscreen handles the small print (micro-labels, badges), and
   Chivo Mono carries the body copy — quiet, technical, comfortable
   in the dark. The three never share a line. */
const sans = Chivo_Mono({
  variable: "--font-sans",
  subsets: ["latin"],
});

const display = Jersey_15({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const pixel = Silkscreen({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: ["400", "700"],
});

/**
 * What is true of every page; the words live in lib/site.ts. The
 * homepage's own address (the canonical link and og:url) is set in
 * app/page.tsx and not here: a page inherits whatever its layout says,
 * and with those two here every tool, the 404 and the lab said they were
 * the homepage. A page that describes itself builds its own block with
 * `pageMetadata` / `toolMetadata`.
 */
export const metadata: Metadata = {
  // Brand visual is the unspaced wordmark "hugoslekstuga"; the
  // searchable name is the spaced form "Hugos Lekstuga". Both
  // appear in titles/descriptions so Google matches either query.
  title: {
    default: SITE_TITLE,
    template: TITLE_TEMPLATE,
  },
  description: SITE_TAGLINE,
  metadataBase: new URL(SITE_URL),
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
  openGraph: SITE_OPEN_GRAPH,
  twitter: SITE_TWITTER,
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
      className={`${sans.variable} ${display.variable} ${pixel.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-ink">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
        />
        <SearchProvider>
          <BrandCorner />
          <div className="flex-1">{children}</div>
          <ConditionalFooter />
          <SearchPalette />
          <TravelingDot />
        </SearchProvider>
      </body>
    </html>
  );
}
