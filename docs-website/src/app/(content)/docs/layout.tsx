import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { sideBarOptions } from '@/lib/layout.shared'
import { docsSource } from '@/lib/source'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={docsSource.pageTree}
      {...sideBarOptions()}
      sidebar={{ collapsible: false }}
      searchToggle={{ components: { lg: false } }}
    >
      {children}
    </DocsLayout>
  )
}
