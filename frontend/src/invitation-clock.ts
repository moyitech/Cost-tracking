import { useEffect, useState } from 'react'
import { useDidShow } from '@tarojs/taro'

export function useInvitationClock() {
  const [now, setNow] = useState(Date.now)
  useDidShow(() => setNow(Date.now()))
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  return now
}
