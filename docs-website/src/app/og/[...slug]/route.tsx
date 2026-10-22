import { renderOpenGraphImage } from '@/lib/docs-og-image'

export const revalidate = false

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await params
  return renderOpenGraphImage(slug)
}
