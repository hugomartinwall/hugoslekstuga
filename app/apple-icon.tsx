import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const tile = (color: string) => ({
    width: "64px",
    height: "64px",
    background: color,
    border: "6px solid #1a1812",
    borderRadius: "10px",
    display: "flex",
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fbf6ee",
          borderRadius: "40px",
          display: "flex",
          flexDirection: "column",
          padding: "22px",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={tile("#ffc233")} />
          <div style={tile("#ff7ab2")} />
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={tile("#4f66f2")} />
          <div style={tile("#ff5a3c")} />
        </div>
      </div>
    ),
    { ...size },
  );
}
