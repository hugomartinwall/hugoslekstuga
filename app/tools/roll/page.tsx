import { toolMetadata } from "@/lib/site";
import Client from "./Client";

export const metadata = toolMetadata("roll");

export default function Page() {
  return <Client />;
}
