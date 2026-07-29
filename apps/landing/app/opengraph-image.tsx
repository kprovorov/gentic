import { ImageResponse } from "next/og"

export const alt = "Gentic"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#ffffff",
        color: "#17220A",
        padding: "72px",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "28px",
          maxWidth: "700px",
        }}
      >
        <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1 }}>
          Gentic
        </div>
        <div style={{ fontSize: 40, lineHeight: 1.18, color: "#35530E" }}>
          Create coding issues, assign them to AI agents, and get pull requests
          back for review.
        </div>
      </div>
      <div
        style={{
          width: "260px",
          height: "260px",
          borderRadius: "64px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#9AE600",
          color: "#35530E",
          fontSize: 210,
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        G
      </div>
    </div>,
    size
  )
}
