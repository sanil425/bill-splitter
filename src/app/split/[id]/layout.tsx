import { Suspense } from "react";
import { SplitProvider } from "@/components/split-store";

// The split lives in localStorage, so the route id is read on the client.
export default function SplitLayout({ children }: LayoutProps<"/split/[id]">) {
  return (
    <Suspense>
      <SplitProvider>{children}</SplitProvider>
    </Suspense>
  );
}
