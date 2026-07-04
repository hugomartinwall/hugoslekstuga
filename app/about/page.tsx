import type { Metadata } from "next";
import Client from "./Client";

export const metadata: Metadata = {
  title: "About",
  description: "lekstuga (n., Swedish). Potentially useful.",
};

export default function AboutPage() {
  return <Client />;
}
