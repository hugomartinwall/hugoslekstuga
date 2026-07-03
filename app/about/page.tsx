import type { Metadata } from "next";
import Client from "./Client";

export const metadata: Metadata = {
  title: "About",
  description:
    "Hugo builds small browser toys in the off-hours. The ones worth keeping end up here — plugged in, open all night.",
};

export default function AboutPage() {
  return <Client />;
}
