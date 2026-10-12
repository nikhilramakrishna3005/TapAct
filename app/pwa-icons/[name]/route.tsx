import { ImageResponse } from "next/og";
import { getAppIconSvg } from "@/lib/appIcon";

export const dynamic = "force-static";

const ICONS: Record<string, { size: number; maskable: boolean }> = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: true },
  "favicon-32.png": { size: 32, maskable: false },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const icon = ICONS[name];
  if (!icon) {
    return new Response("Not found", { status: 404 });
  }
  const src = `data:image/svg+xml;base64,${Buffer.from(
    getAppIconSvg({ maskable: icon.maskable }),
  ).toString("base64")}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={icon.size} height={icon.size} alt="" />,
    { width: icon.size, height: icon.size },
  );
}
