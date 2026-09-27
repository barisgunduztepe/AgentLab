import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AgentLab",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
