import { ImageResponse } from "next/og";
import { tools } from "@/lib/tools";
import { COLOR_HEX, preferredTextHex } from "@/lib/colors";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "hugoslekstuga — a small playhouse for tools";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fbf6ee",
          color: "#1a1812",
          display: "flex",
          flexDirection: "column",
          padding: "80px",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Top-left chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "10px 22px",
            background: "#ffc233",
            border: "3px solid #1a1812",
            borderRadius: "9999px",
            fontSize: "22px",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            alignSelf: "flex-start",
          }}
        >
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "9999px",
              background: "#1a1812",
            }}
          />
          A small playhouse
        </div>

        {/* Wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            marginTop: "60px",
            fontSize: "150px",
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.04em",
          }}
        >
          hugoslekstuga
          <div
            style={{
              width: "26px",
              height: "26px",
              borderRadius: "9999px",
              background: "#ff5a3c",
              marginLeft: "10px",
              marginBottom: "20px",
            }}
          />
        </div>

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            marginTop: "30px",
            fontSize: "44px",
            fontWeight: 600,
            color: "#4a463d",
            lineHeight: 1.2,
          }}
        >
          Small, useful browser tools.
        </div>

        {/* Tool slug row — derived from the registry. Wraps to multiple lines
            as the catalogue grows, so adding a tool to lib/tools.ts updates
            the OG image automatically. Sized small enough to fit ~50 chips. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            marginTop: "auto",
          }}
        >
          {tools.map((t) => (
            <div
              key={t.slug}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 14px",
                background: COLOR_HEX[t.color],
                border: "3px solid #1a1812",
                borderRadius: "9999px",
                fontSize: "18px",
                fontWeight: 800,
                color: preferredTextHex(t.color),
              }}
            >
              {t.slug}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
