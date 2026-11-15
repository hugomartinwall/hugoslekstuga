import { toolMetadata } from "@/lib/site";
import Client from "./Client";

export const metadata = toolMetadata("sjokort");

export default function Page() {
  return <Client />;
}
