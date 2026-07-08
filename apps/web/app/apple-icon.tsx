import { ImageResponse } from "next/og"

export const size = { width: 512, height: 512 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    (
      <svg
        width={512}
        height={512}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="64" height="64" fill="#9aff00" />
        <path
          d="M33 11c-13 0-23 9.5-23 21.5S20 54 33 54c7.4 0 13.7-3 17.7-7.8V30.5H32.3v9.4h7.8v2.5c-1.9 1.4-4.4 2.2-7.1 2.2-7.1 0-12.5-5.2-12.5-12.1S25.9 20.4 33 20.4c4.2 0 7.8 1.8 10.1 4.7l7.7-6.3C46.6 13.9 40.4 11 33 11Z"
          fill="#244d16"
        />
      </svg>
    ),
    size
  )
}
