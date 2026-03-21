/** @type {import('next').NextConfig} */
const supabaseStorageHostname = (() => {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
})();

const remotePatterns: Array<{
  protocol: "https";
  hostname: string;
  pathname?: string;
}> = [
  { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
  { protocol: "https", hostname: "lh3.googleusercontent.com" },
  { protocol: "https", hostname: "www.google.com" },
  { protocol: "https", hostname: "i.pravatar.cc" },
  { protocol: "https", hostname: "images.unsplash.com" },
  { protocol: "https", hostname: "github.com" },
  { protocol: "https", hostname: "avatars.githubusercontent.com" },
  { protocol: "https", hostname: "placehold.co" },
  { protocol: "https", hostname: "via.placeholder.com" },
  { protocol: "https", hostname: "www.svgrepo.com" },
  { protocol: "https", hostname: "api.dicebear.com" },
];

if (supabaseStorageHostname) {
  remotePatterns.push({
    protocol: "https",
    hostname: supabaseStorageHostname,
    pathname: "/storage/v1/object/public/**",
  });
}

const nextConfig = {
  reactStrictMode: false,
  turbopack: {
    root: process.cwd(),
  },
  images: {
    formats: ["image/avif", "image/webp"],
    localPatterns: [{ pathname: "/**" }],
    remotePatterns,
  },
};

export default nextConfig;
