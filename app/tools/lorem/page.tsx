import { toolMetadata } from "@/lib/site";
import Client from "./Client";

export const metadata = toolMetadata("lorem");

export default function Page() {
  return <Client />;
}
