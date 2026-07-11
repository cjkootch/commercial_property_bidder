import type { Metadata } from "next";
import "./globals.css";
import { Chrome } from "@/components/Chrome";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://greenkeep.us"),
  title: "Greenkeep",
  description:
    "High-intent commercial job leads for local service companies — landscaping, pest control, cleaning, HVAC, fire protection, roofing, and more, across 9 Texas metros.",
  openGraph: {
    title: "Greenkeep — buy the job, not the click",
    description:
      "High-intent commercial leads across 11 service trades and 9 Texas metros — verified against county records, capped at 3 companies per trade. First sheet free.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght,XOPQ,XTRA,YOPQ,YTDE,YTFI,YTLC,YTUC@8..144,100..1000,96,468,79,-203,738,514,712&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
