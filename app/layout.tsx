import type { Metadata } from "next";
import { Geist, Bricolage_Grotesque } from "next/font/google";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
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
  title: {
    default: "hugoslekstuga — a small playhouse for tools",
    template: "%s — hugoslekstuga",
  },
  description:
    "A small playhouse of useful, friendly browser tools. Built with care, in the open.",
  metadataBase: new URL("https://hugoslekstuga.se"),
  openGraph: {
    title: "hugoslekstuga",
    description:
      "A small playhouse of useful, friendly browser tools.",
    url: "https://hugoslekstuga.se",
    siteName: "hugoslekstuga",
    locale: "en",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "hugoslekstuga",
    description: "A small playhouse of useful, friendly browser tools.",
  },
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
        <SearchProvider>
          <Nav />
          <div className="flex-1">{children}</div>
          <Footer />
          <SearchPalette />
        </SearchProvider>
      </body>
    </html>
  );
}
