import { toolMetadata } from "@/lib/site";
import Client from "./Client";

export const metadata = toolMetadata("breathe");

export default function Page() {
  return <Client />;
}
