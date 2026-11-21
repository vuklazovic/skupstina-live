import type { Mp } from '../types'

export function Portrait({ mp, name, color, size }: { mp?: Mp; name: string; color: string; size: number }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  return (
    <div className="portrait" style={{ width: size, height: size, ['--c' as string]: color }}>
      {mp?.photo ? <img src={mp.photo} alt="" loading="lazy" /> : <span style={{ fontSize: size * 0.36 }}>{initials}</span>}
    </div>
  )
}
