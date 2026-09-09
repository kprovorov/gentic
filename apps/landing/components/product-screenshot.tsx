import Image, { type StaticImageData } from "next/image"

export function ProductScreenshot({
  src,
  alt,
  sizes,
  eager = false,
}: {
  src: StaticImageData
  alt: string
  sizes: string
  eager?: boolean
}) {
  return (
    <a
      className="product-screenshot"
      href={src.src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${alt}. Open full-size screenshot in a new tab`}
    >
      <Image
        unoptimized
        src={src}
        alt={alt}
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
      />
      <span className="screenshot-enlarge">View full size ↗</span>
    </a>
  )
}
