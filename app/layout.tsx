import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CareMate 爱护AI',
  description: 'AI 病中代理人实时语音 Demo',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}

