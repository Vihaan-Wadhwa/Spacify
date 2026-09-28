import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider, themeInitScript } from "@/components/ThemeProvider";
import "./globals.css";

// DM Sans + DM Serif Display (SIL Open Font License), self-hosted so builds don't depend on Google Fonts.
const dmSans = localFont({
  variable: "--font-sans",
  src: [
    { path: "./fonts/dm-sans-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "./fonts/dm-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

const dmSerif = localFont({
  variable: "--font-serif",
  src: [
    { path: "./fonts/dm-serif-display-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-serif-display-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
});

export const metadata: Metadata = {
  title: "Spacify — AI-Powered Floor Plans",
  description:
    "Upload your floor plan, label your rooms, and watch Spacify build an interactive 3D model.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before paint by themeInitScript, so React may see a different value
    <html lang="en" data-theme="dark" className={`${dmSans.variable} ${dmSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
