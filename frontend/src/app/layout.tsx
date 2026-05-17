import type { Metadata } from "next";
import { Inter, EB_Garamond } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin"],
});

const ebGaramond = EB_Garamond({
    variable: "--font-eb-garamond",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
    metadataBase: new URL("https://app.mikeoss.com"),
    title: "EU-Mike — AI EU Law Assistant",
    description:
        "AI-powered EU law research assistant with live access to EUR-Lex and CJEU case law. Built on the open-source Mike platform.",
    icons: {
        icon: [
            { url: "/icon.svg", type: "image/svg+xml" },
            { url: "/favicon.ico" },
        ],
        apple: "/apple-touch-icon.png",
    },
    openGraph: {
        type: "website",
        url: "https://app.mikeoss.com",
        siteName: "EU-Mike",
        title: "EU-Mike — AI EU Law Assistant",
        description:
            "AI-powered EU law research assistant with live access to EUR-Lex and CJEU case law.",
        images: [
            {
                url: "/link-image.jpg",
                width: 1200,
                height: 651,
                alt: "EU-Mike",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: "EU-Mike — AI EU Law Assistant",
        description:
            "AI-powered EU law research assistant with live access to EUR-Lex and CJEU case law.",
        images: ["/link-image.jpg"],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body
                className={`${inter.variable} ${ebGaramond.variable} font-sans antialiased`}
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}

