import type { Metadata } from "next";
import Client from "./Client";

export const metadata: Metadata = {
  title: "Noodle",
  description:
    "Eat dots. Don't get bumped. Grow long. A multiplayer snake game in your browser.",
};

export default function Page() {
  return <Client />;
}
