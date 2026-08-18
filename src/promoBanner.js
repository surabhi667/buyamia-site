export const promoBannerMessages = [
  {
    id: 'discover',
    text: 'Discover and shop premium Indonesian products at our online wholesale marketplace',
    arrow: '→',
    href: '/categories',
    action: 'catalog',
  },
  {
    id: 'welcome-discount',
    text: 'Sign up today and get 10% off your first order',
    arrow: '→',
    href: '/signup',
    action: 'signup',
  },
]

export function nextBannerIndex(current, count = promoBannerMessages.length) {
  if (!count) return 0
  return (current + 1) % count
}
