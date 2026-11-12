import { toolMetadata } from "@/lib/site";
import Client from "./Client";

export const metadata = toolMetadata("focus");

export default function Page() {
  return <Client />;
}
