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
    <div className="product-screenshot">
      <Image
        unoptimized
        src={src}
        alt={alt}
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
      />
    </div>
  )
}
