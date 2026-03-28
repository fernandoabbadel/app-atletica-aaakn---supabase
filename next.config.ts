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
  { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/sign/**" },
  { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/authenticated/**" },
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
  remotePatterns.push({
    protocol: "https",
    hostname: supabaseStorageHostname,
    pathname: "/storage/v1/object/sign/**",
  });
  remotePatterns.push({
    protocol: "https",
    hostname: supabaseStorageHostname,
    pathname: "/storage/v1/object/authenticated/**",
  });
}

const nextConfig = {
  reactStrictMode: false,
  turbopack: {
    root: process.cwd(),
  },
  async redirects() {
    return [
      {
        source: "/sharkround/:path*",
        destination: "/boardround/:path*",
        permanent: true,
      },
      {
        source: "/admin/sharkround/:path*",
        destination: "/admin/boardround/:path*",
        permanent: true,
      },
      {
        source: "/ligas_unitau",
        destination: "/ligas_usc",
        permanent: true,
      },
      {
        source: "/:tenant/sharkround/:path*",
        destination: "/:tenant/boardround/:path*",
        permanent: true,
      },
      {
        source: "/:tenant/admin/sharkround/:path*",
        destination: "/:tenant/admin/boardround/:path*",
        permanent: true,
      },
      {
        source: "/:tenant/ligas_unitau",
        destination: "/:tenant/ligas_usc",
        permanent: true,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    localPatterns: [{ pathname: "/**" }],
    remotePatterns,
  },
};

export default nextConfig;
