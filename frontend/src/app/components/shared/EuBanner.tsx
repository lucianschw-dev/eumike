/**
 * EU-Mike top banner.
 *
 * Renders a thin EU-blue strip across the top of every authed page.
 * On the left: a proper EU flag SVG (12 gold five-pointed stars on
 * EU blue) and the "EU-Mike" name. On the right: a small "Created by"
 * credit. Designed to be quietly present, not dominant — height stays
 * compact so it doesn't eat content area.
 */

import * as React from "react";

const EU_BLUE = "#003399";
const EU_GOLD = "#FFCC00";

function EuFlag({ size = 28 }: { size?: number }) {
    // Twelve five-pointed stars arranged on a circle, drawn properly
    // (not text characters). Each star points up; centred on the field
    // per the official EU flag spec. Coordinates computed for a 12×8
    // unit field then scaled.
    const stars = Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const cx = 12 + Math.cos(angle) * 5.5;
        const cy = 8 + Math.sin(angle) * 5.5;
        return <Star key={i} cx={cx} cy={cy} r={0.9} fill={EU_GOLD} />;
    });
    return (
        <svg
            width={size * 1.5}
            height={size}
            viewBox="0 0 24 16"
            role="img"
            aria-label="Flag of the European Union"
            style={{
                display: "block",
                borderRadius: 2,
                boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
            }}
        >
            <rect width="24" height="16" fill={EU_BLUE} />
            {stars}
        </svg>
    );
}

function Star({
    cx,
    cy,
    r,
    fill,
}: {
    cx: number;
    cy: number;
    r: number;
    fill: string;
}) {
    // Build a five-pointed star polygon by alternating outer and inner
    // radii at 36° steps, starting pointing up.
    const points: string[] = [];
    for (let i = 0; i < 10; i++) {
        const outer = i % 2 === 0;
        const radius = outer ? r : r * 0.4;
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        points.push(`${x.toFixed(3)},${y.toFixed(3)}`);
    }
    return <polygon points={points.join(" ")} fill={fill} />;
}

export function EuBanner() {
    return (
        <div
            style={{
                height: 44,
                background: EU_BLUE,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 16px",
                fontSize: 13,
                flexShrink: 0,
                borderBottom: `1px solid rgba(255,255,255,0.15)`,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <EuFlag size={26} />
                <span
                    style={{
                        fontWeight: 600,
                        letterSpacing: 0.4,
                        fontSize: 15,
                    }}
                >
                    EU-Mike
                </span>
                <span
                    style={{
                        opacity: 0.85,
                        fontSize: 12,
                        display: "none",
                    }}
                    className="sm:!inline"
                >
                    · AI EU Law Assistant
                </span>
            </div>
            <span style={{ opacity: 0.85, fontSize: 11 }}>
                Created by Lucian Schwartz-Croft
            </span>
        </div>
    );
}
