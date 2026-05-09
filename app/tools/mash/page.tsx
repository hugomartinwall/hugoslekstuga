import type { Metadata } from "next";
import { findTool } from "@/lib/tools";
import Client from "./Client";

const tool = findTool("mash")!;

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
};

export default function Page() {
  return <Client />;
}
