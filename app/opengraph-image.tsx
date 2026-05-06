import { ImageResponse } from "next/og";

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

        {/* Tool color row — wraps to a second line as the toolset grows. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "12px",
            marginTop: "auto",
          }}
        >
          {[
            { c: "#ffc233", t: "advice" },
            { c: "#ff7ab2", t: "feeling" },
            { c: "#4f66f2", t: "convert" },
            { c: "#3fa66e", t: "focus" },
            { c: "#ff5a3c", t: "qr" },
            { c: "#9333ea", t: "read" },
            { c: "#f97316", t: "roll" },
            { c: "#0d9488", t: "palette" },
            { c: "#3fa66e", t: "three" },
            { c: "#4f66f2", t: "breathe" },
            { c: "#ffc233", t: "tip" },
            { c: "#9333ea", t: "until" },
            { c: "#4f66f2", t: "sleep" },
            { c: "#ff7ab2", t: "idea" },
            { c: "#ff5a3c", t: "markdown" },
            { c: "#f97316", t: "diff" },
            { c: "#3fa66e", t: "stretch" },
            { c: "#ffc233", t: "emoji" },
            { c: "#9333ea", t: "memory" },
            { c: "#0d9488", t: "sketch" },
          ].map((p) => (
            <div
              key={p.t}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 18px",
                background: p.c,
                border: "3px solid #1a1812",
                borderRadius: "9999px",
                fontSize: "22px",
                fontWeight: 800,
                color: p.c === "#ffc233" || p.c === "#ff7ab2" ? "#1a1812" : "#fbf6ee",
              }}
            >
              {p.t}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
