import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@gentic/ui", "@gentic/supabase", "@gentic/validators"],
}

export default nextConfig
