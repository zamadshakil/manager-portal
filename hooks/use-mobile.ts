import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const DESKTOP_BREAKPOINT = 1024

function useViewportWidth() {
  const [width, setWidth] = React.useState<number | null>(null)

  React.useEffect(() => {
    const onChange = () => {
      setWidth(window.innerWidth)
    }
    onChange()
    window.addEventListener('resize', onChange)
    return () => window.removeEventListener('resize', onChange)
  }, [])

  return width
}

export function useIsMobile() {
  const width = useViewportWidth()
  return width !== null && width < MOBILE_BREAKPOINT
}

export function useIsBelowDesktop() {
  const width = useViewportWidth()
  return width !== null && width < DESKTOP_BREAKPOINT
}

export function useIsTablet() {
  const width = useViewportWidth()
  return width !== null && width >= MOBILE_BREAKPOINT && width < DESKTOP_BREAKPOINT
}
