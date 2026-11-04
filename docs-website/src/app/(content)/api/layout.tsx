import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { sideBarOptions } from '@/lib/layout.shared'
import { apiSource } from '@/lib/source'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={apiSource.pageTree}
      {...sideBarOptions()}
      sidebar={{ collapsible: false }}
      searchToggle={{ components: { lg: false } }}
    >
      {children}
    </DocsLayout>
  )
}
