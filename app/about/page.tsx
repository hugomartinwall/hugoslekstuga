import type { Metadata } from "next";
import Client from "./Client";

export const metadata: Metadata = {
  title: "About",
  description:
    "lekstuga (n., Swedish): a small house where children play. Also: this. Potentially useful stuff.",
};

export default function AboutPage() {
  return <Client />;
}
